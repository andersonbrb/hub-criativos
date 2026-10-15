import "server-only";

import { and, desc, eq, gte, isNotNull, isNull, or } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { conexaoTokens, conexoes, oauthClientes, oauthCodigos } from "@/db/schema";
import { buscarUsuario } from "@/features/acesso/servicos/sessao";
import { APPS, type ConexaoNaTela } from "@/features/conector/contrato";
import { ErroOAuth } from "@/features/conector/erros";
import {
  ESCOPO_HUB,
  INATIVIDADE_MAXIMA_MS,
  VALIDADE_ACESSO_MS,
  VALIDADE_RENOVACAO_MS,
} from "@/features/conector/servicos/config";
import { appDoRedirect, pkceConfere, recursoConfere } from "@/features/conector/servicos/oauth";
import { PREFIXO_ACESSO, PREFIXO_RENOVACAO, hashDe, novo } from "@/features/conector/servicos/segredos";

// Código, token e conexão: a troca, a renovação, a revogação e a conferência.
//
// AS DUAS REGRAS QUE REVOGAM TUDO. Cliente público não tem segredo, e um código ou token de renovação copiado no
// caminho é o único jeito de alguém se passar pelo Claude de outra pessoa. A OAuth 2.1 dá o sinal de cópia:
//   • código de autorização apresentado DUAS vezes: o segundo uso revoga a conexão que o primeiro criou;
//   • token de renovação ANTIGO apresentado de novo: cada renovação aposenta o anterior, e o aposentado voltando
//     revoga a conexão inteira.
// Nos dois casos não dá para saber quem é o legítimo, então os dois perdem: a pessoa conecta de novo, e quem copiou
// fica com um token morto.

export type Conexao = typeof conexoes.$inferSelect;

export type MotivoRevogacao =
  | "desconectada"
  | "revogada_pelo_cliente"
  | "codigo_reusado"
  | "renovacao_reusada"
  | "inatividade"
  | "usuario_inativo";

// Uma linha de auditoria no log do servidor (aparece no log do Railway). Nunca recebe segredo: só ids e motivos.
export function registrarEvento(evento: string, dados: Record<string, unknown>) {
  console.info(`[conector] ${evento} ${JSON.stringify(dados)}`);
}

const ativa = (c: Conexao, agora = Date.now()) =>
  !c.revogadaEm && (c.ultimoUsoEm ?? c.criadoEm).getTime() >= agora - INATIVIDADE_MAXIMA_MS;

// Revoga a conexão e todos os tokens dela. Condicional: dois pedidos revogando ao mesmo tempo não se sobrescrevem, e
// o primeiro motivo é o que fica. Devolve false se já estava revogada.
export async function revogarConexao(conexaoId: string, motivo: MotivoRevogacao, porId: string | null = null): Promise<boolean> {
  const db = banco();
  const agora = new Date();
  const mudou = await db
    .update(conexoes)
    .set({ revogadaEm: agora, motivoRevogacao: motivo, revogadaPor: porId })
    .where(and(eq(conexoes.id, conexaoId), isNull(conexoes.revogadaEm)))
    .returning({ id: conexoes.id, usuarioId: conexoes.usuarioId });
  await db
    .update(conexaoTokens)
    .set({ revogadoEm: agora })
    .where(and(eq(conexaoTokens.conexaoId, conexaoId), isNull(conexaoTokens.revogadoEm)));
  if (mudou.length) registrarEvento("revogada", { conexao: conexaoId, usuario: mudou[0].usuarioId, motivo, por: porId });
  return mudou.length > 0;
}

// O banco ou uma transação aberta: os dois sabem inserir.
type Gravador = Pick<Banco, "insert">;

// Um par novo (acesso + renovação), no formato da RFC 6749 §5.1.
async function emitirTokens(db: Gravador, conexao: Pick<Conexao, "id" | "escopos">) {
  const agora = Date.now();
  const acesso = novo(PREFIXO_ACESSO);
  const renovacao = novo(PREFIXO_RENOVACAO);
  await db.insert(conexaoTokens).values([
    { conexaoId: conexao.id, tipo: "acesso", tokenHash: hashDe(acesso), expiraEm: new Date(agora + VALIDADE_ACESSO_MS) },
    { conexaoId: conexao.id, tipo: "renovacao", tokenHash: hashDe(renovacao), expiraEm: new Date(agora + VALIDADE_RENOVACAO_MS) },
  ]);
  return {
    access_token: acesso,
    token_type: "Bearer",
    expires_in: Math.round(VALIDADE_ACESSO_MS / 1000),
    refresh_token: renovacao,
    scope: (conexao.escopos.length ? conexao.escopos : [ESCOPO_HUB]).join(" "),
  };
}

async function clientePorId(clientId: unknown) {
  if (!clientId) throw new ErroOAuth("invalid_request", "Falta o client_id.");
  const [cliente] = await banco().select().from(oauthClientes).where(eq(oauthClientes.clientId, String(clientId))).limit(1);
  if (!cliente) throw new ErroOAuth("invalid_client", "Cliente desconhecido. Remova o conector no Claude e adicione de novo.", 401);
  return cliente;
}

type Dados = Record<string, string>;

// grant_type=authorization_code: confere tudo e cria a conexão.
export async function trocarCodigo(dados: Dados) {
  const faltando = (["code", "redirect_uri", "code_verifier"] as const).filter((c) => !dados[c]);
  if (faltando.length) throw new ErroOAuth("invalid_request", `Faltam campos: ${faltando.join(", ")}.`);
  const cliente = await clientePorId(dados.client_id);
  const db = banco();

  const [codigo] = await db.select().from(oauthCodigos).where(eq(oauthCodigos.codigoHash, hashDe(dados.code))).limit(1);
  if (!codigo || codigo.clienteId !== cliente.id) throw new ErroOAuth("invalid_grant", "Código de autorização inválido.");

  if (codigo.usadoEm) {
    // O segundo uso é o sinal de cópia. Revoga ANTES de responder, fora de transação, para a revogação não voltar
    // atrás junto com o erro.
    if (codigo.conexaoId) await revogarConexao(codigo.conexaoId, "codigo_reusado");
    throw new ErroOAuth("invalid_grant", "Este código já foi usado. Por segurança, a conexão criada com ele foi revogada.");
  }
  const agora = new Date();
  if (codigo.expiraEm <= agora) throw new ErroOAuth("invalid_grant", "O código de autorização venceu. Conecte de novo.");
  if (dados.redirect_uri !== codigo.redirectUri) throw new ErroOAuth("invalid_grant", "O redirect_uri não é o mesmo da autorização.");
  if (!pkceConfere(dados.code_verifier, codigo.codeChallenge)) {
    throw new ErroOAuth("invalid_grant", "O code_verifier não confere com o code_challenge (PKCE).");
  }
  if (dados.resource && !recursoConfere(dados.resource, codigo.resource)) {
    throw new ErroOAuth("invalid_target", "O resource não é o mesmo da autorização.");
  }
  const usuario = await buscarUsuario(codigo.usuarioId);
  if (!usuario?.ativo) throw new ErroOAuth("invalid_grant", "A conta de quem autorizou está desativada.");

  const resultado = await db.transaction(async (tx) => {
    // Condicional: dois pedidos com o mesmo código ao mesmo tempo, só um ganha. O outro cai como reuso.
    const ganhou = await tx
      .update(oauthCodigos)
      .set({ usadoEm: agora })
      .where(and(eq(oauthCodigos.id, codigo.id), isNull(oauthCodigos.usadoEm)))
      .returning({ id: oauthCodigos.id });
    if (!ganhou.length) return null;
    const [conexao] = await tx
      .insert(conexoes)
      .values({
        usuarioId: codigo.usuarioId,
        clienteId: cliente.id,
        app: appDoRedirect(codigo.redirectUri),
        escopos: codigo.escopos.length ? codigo.escopos : [ESCOPO_HUB],
        audiencia: codigo.resource,
        ip: codigo.ip,
        ultimoUsoEm: agora,
      })
      .returning();
    await tx.update(oauthCodigos).set({ conexaoId: conexao.id }).where(eq(oauthCodigos.id, codigo.id));
    return { conexao, tokens: await emitirTokens(tx, conexao) };
  });
  if (!resultado) throw new ErroOAuth("invalid_grant", "Este código já foi usado.");

  registrarEvento("conectada", { conexao: resultado.conexao.id, usuario: codigo.usuarioId, app: resultado.conexao.app, cliente: cliente.nome, ip: codigo.ip });
  return resultado.tokens;
}

// grant_type=refresh_token: rotação obrigatória, reuso revoga tudo.
export async function renovar(dados: Dados) {
  if (!dados.refresh_token) throw new ErroOAuth("invalid_request", "Falta o refresh_token.");
  const db = banco();
  const [linha] = await db
    .select({ token: conexaoTokens, conexao: conexoes, clientId: oauthClientes.clientId })
    .from(conexaoTokens)
    .innerJoin(conexoes, eq(conexoes.id, conexaoTokens.conexaoId))
    .innerJoin(oauthClientes, eq(oauthClientes.id, conexoes.clienteId))
    .where(and(eq(conexaoTokens.tipo, "renovacao"), eq(conexaoTokens.tokenHash, hashDe(dados.refresh_token))))
    .limit(1);
  if (!linha) throw new ErroOAuth("invalid_grant", "Token de renovação inválido.");
  const { token, conexao } = linha;
  if (dados.client_id && dados.client_id !== linha.clientId) throw new ErroOAuth("invalid_grant", "Token de renovação emitido para outro cliente.");

  const revogarERecusar = async (motivo: MotivoRevogacao, descricao: string): Promise<never> => {
    await revogarConexao(conexao.id, motivo);
    throw new ErroOAuth("invalid_grant", descricao);
  };

  if (token.usadoEm) await revogarERecusar("renovacao_reusada", "Token de renovação já usado. Por segurança, a conexão foi revogada; conecte de novo.");
  const agora = new Date();
  if (token.revogadoEm || conexao.revogadaEm) throw new ErroOAuth("invalid_grant", "Esta conexão foi revogada. Conecte de novo.");
  if (token.expiraEm <= agora) throw new ErroOAuth("invalid_grant", "O token de renovação venceu. Conecte de novo.");
  if (!ativa(conexao, agora.getTime())) await revogarERecusar("inatividade", "A conexão expirou por falta de uso. Conecte de novo.");
  const usuario = await buscarUsuario(conexao.usuarioId);
  if (!usuario?.ativo) await revogarERecusar("usuario_inativo", "A conta desta conexão está desativada.");

  const tokens = await db.transaction(async (tx) => {
    const ganhou = await tx
      .update(conexaoTokens)
      .set({ usadoEm: agora })
      .where(and(eq(conexaoTokens.id, token.id), isNull(conexaoTokens.usadoEm), isNull(conexaoTokens.revogadoEm)))
      .returning({ id: conexaoTokens.id });
    if (!ganhou.length) return null;
    await tx.update(conexoes).set({ ultimoUsoEm: agora }).where(eq(conexoes.id, conexao.id));
    return emitirTokens(tx, conexao);
  });
  // Outro pedido usou este mesmo token no mesmo instante: é reuso.
  if (!tokens) return revogarERecusar("renovacao_reusada", "Token de renovação já usado.");
  return tokens;
}

// RFC 7009. Token desconhecido responde 200 do mesmo jeito (§2.2). Revogar a RENOVAÇÃO derruba a conexão inteira (é
// o "sair" do Claude); revogar o ACESSO derruba só ele.
export async function revogarToken(dados: Dados): Promise<void> {
  if (!dados.token) throw new ErroOAuth("invalid_request", "Falta o token.");
  const db = banco();
  const [linha] = await db
    .select({ token: conexaoTokens, clientId: oauthClientes.clientId })
    .from(conexaoTokens)
    .innerJoin(conexoes, eq(conexoes.id, conexaoTokens.conexaoId))
    .innerJoin(oauthClientes, eq(oauthClientes.id, conexoes.clienteId))
    .where(eq(conexaoTokens.tokenHash, hashDe(dados.token)))
    .limit(1);
  if (!linha) return;
  if (dados.client_id && dados.client_id !== linha.clientId) throw new ErroOAuth("invalid_client", "Token emitido para outro cliente.", 401);
  if (linha.token.tipo === "renovacao") await revogarConexao(linha.token.conexaoId, "revogada_pelo_cliente");
  else await db.update(conexaoTokens).set({ revogadoEm: new Date() }).where(and(eq(conexaoTokens.id, linha.token.id), isNull(conexaoTokens.revogadoEm)));
}

// A conexão do token de acesso, se ele vale para este endereço. NÃO confere a pessoa nem as chaves: quem chama faz
// isso a cada chamada.
export async function conexaoDoToken(valor: string, audienciaEsperada: string): Promise<Conexao | null> {
  if (!valor || valor.length > 200) return null;
  const [linha] = await banco()
    .select({ token: conexaoTokens, conexao: conexoes })
    .from(conexaoTokens)
    .innerJoin(conexoes, eq(conexoes.id, conexaoTokens.conexaoId))
    .where(and(eq(conexaoTokens.tipo, "acesso"), eq(conexaoTokens.tokenHash, hashDe(valor))))
    .limit(1);
  if (!linha) return null;
  const agora = Date.now();
  const { token, conexao } = linha;
  if (token.revogadoEm || token.expiraEm.getTime() <= agora || conexao.revogadaEm) return null;
  if (!ativa(conexao, agora)) {
    await revogarConexao(conexao.id, "inatividade");
    return null;
  }
  if (!recursoConfere(conexao.audiencia, audienciaEsperada)) return null;
  return conexao;
}

export async function registrarUso(conexaoId: string) {
  await banco().update(conexoes).set({ ultimoUsoEm: new Date() }).where(eq(conexoes.id, conexaoId));
}

// Conexões ATIVAS da pessoa (não revogadas e usadas nos últimos 60 dias), para a tela.
export async function conexoesDaPessoa(usuarioId: string): Promise<ConexaoNaTela[]> {
  const limite = new Date(Date.now() - INATIVIDADE_MAXIMA_MS);
  const linhas = await banco()
    .select({ conexao: conexoes, clienteNome: oauthClientes.nome })
    .from(conexoes)
    .innerJoin(oauthClientes, eq(oauthClientes.id, conexoes.clienteId))
    .where(
      and(
        eq(conexoes.usuarioId, usuarioId),
        isNull(conexoes.revogadaEm),
        or(and(isNotNull(conexoes.ultimoUsoEm), gte(conexoes.ultimoUsoEm, limite)), and(isNull(conexoes.ultimoUsoEm), gte(conexoes.criadoEm, limite))),
      ),
    )
    .orderBy(desc(conexoes.criadoEm));
  return linhas.map(({ conexao: c, clienteNome }) => ({
    id: c.id,
    app: APPS[c.app],
    clienteNome: clienteNome || APPS[c.app],
    criadoEm: c.criadoEm.toISOString(),
    ultimoUsoEm: c.ultimoUsoEm?.toISOString() ?? null,
    ip: c.ip,
  }));
}

// Desconectar pela tela: a pessoa derruba a própria conexão (admin, qualquer uma). Não exige a chave do conector:
// quem perdeu o acesso continua podendo cortar o que deixou ligado. Conexão alheia responde como inexistente, para
// não confirmar que ela existe.
export async function desconectar(conexaoId: string, por: { id: string; admin: boolean }): Promise<"ok" | "nao_encontrada"> {
  if (!/^[0-9a-f-]{36}$/i.test(conexaoId)) return "nao_encontrada";
  const [conexao] = await banco().select().from(conexoes).where(eq(conexoes.id, conexaoId)).limit(1);
  if (!conexao || conexao.revogadaEm || (!por.admin && conexao.usuarioId !== por.id)) return "nao_encontrada";
  await revogarConexao(conexao.id, "desconectada", por.id);
  return "ok";
}
