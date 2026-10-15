import "server-only";

import { and, count, eq, gte, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { conexoes, oauthClientes, oauthPedidos } from "@/db/schema";
import { ErroOAuth } from "@/features/conector/erros";
import {
  ESCOPO_HUB,
  ESCOPO_OFFLINE,
  ROTA_CONSENTIMENTO,
  TITULO_DO_SERVIDOR,
  VALIDADE_PEDIDO_MS,
  basePublica,
  enderecoMcp,
} from "@/features/conector/servicos/config";
import { renovar, revogarToken, trocarCodigo } from "@/features/conector/servicos/conexoes";
import { SEM_CACHE, json, lerCorpo, paginaDeErro, redirecionar } from "@/features/conector/servicos/http";
import { passouDoLimite } from "@/features/conector/servicos/limites";
import { limparVencidos } from "@/features/conector/servicos/limpeza";
import {
  comParametros,
  ipDaRequisicao,
  normalizarEscopos,
  pkceValido,
  recursoConfere,
  redirectConfere,
  redirectPermitido,
} from "@/features/conector/servicos/oauth";
import { novoId } from "@/features/conector/servicos/segredos";

// Rotas PÚBLICAS do servidor de autorização: metadados (/.well-known), registro, authorize, token e revogação.
// Ficam na raiz do endereço (fora de /api) porque é ali que o protocolo procura. Nenhuma usa a sessão do site: quem
// prova quem é o Claude é o código com PKCE, ou o token de renovação. O login acontece só na tela de consentimento.
// Os endpoints ficam em /oauth2/*: o prefixo /oauth/ já é dos metadados do ElevenLabs.

// Registro é público. Duas travas contra enxurrada: um limite por IP e um teto de clientes sem conexão no último dia.
export const LIMITE_REGISTROS_POR_HORA = 20;
const TETO_CLIENTES_SEM_CONEXAO_24H = 500;
// O authorize também é público e também GRAVA (um pedido por chamada, antes de login). Número alto de propósito:
// várias pessoas atrás do mesmo IP podem abrir vários pedidos por hora.
export const LIMITE_AUTORIZACOES_POR_HORA = 60;
// Registro, token e revogação são pedidos de algumas centenas de bytes.
const TETO_CORPO_OAUTH = 16 * 1024;
const TETO_STATE = 1024;
const HORA_MS = 60 * 60_000;

// ---------------------------------------------------------------------------------------------------------------
// Metadados (RFC 9728 e RFC 8414)
// ---------------------------------------------------------------------------------------------------------------

// O resource é EXATAMENTE o endereço colado no Claude.
export async function metadadosDoRecurso(request: Request): Promise<Response> {
  const base = basePublica(request);
  return json({
    resource: enderecoMcp(base),
    authorization_servers: [base],
    scopes_supported: [ESCOPO_HUB],
    bearer_methods_supported: ["header"],
    resource_name: TITULO_DO_SERVIDOR,
  });
}

// O mesmo documento responde em seis caminhos (com e sem /mcp, e em openid-configuration): cliente de OAuth vai
// tentando até achar, e um 404 no meio da descoberta faz alguns desistirem. Este servidor não é provedor de
// identidade (não emite id_token); servir o documento ali é o que a RFC 8414 prevê.
// client_id_metadata_document_supported NÃO é anunciado: só cliente registrado, nunca URL de terceiro.
export async function metadadosDoServidor(request: Request): Promise<Response> {
  const base = basePublica(request);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth2/authorize`,
    token_endpoint: `${base}/oauth2/token`,
    registration_endpoint: `${base}/oauth2/register`,
    revocation_endpoint: `${base}/oauth2/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [ESCOPO_HUB, ESCOPO_OFFLINE],
    authorization_response_iss_parameter_supported: true,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Registro de cliente (RFC 7591)
// ---------------------------------------------------------------------------------------------------------------

const erroRegistro = (codigo: string, descricao: string, status = 400) =>
  json({ error: codigo, error_description: descricao }, status, SEM_CACHE);

const listaDeTexto = (valor: unknown, padrao: string[]) =>
  valor === undefined || valor === null ? padrao : Array.isArray(valor) && valor.every((v) => typeof v === "string") ? (valor as string[]) : null;

export async function registrarCliente(request: Request): Promise<Response> {
  const texto = await lerCorpo(request, TETO_CORPO_OAUTH);
  if (texto === null) return erroRegistro("invalid_client_metadata", "Pedido de registro grande demais.");
  const ip = ipDaRequisicao(request);
  if (passouDoLimite(`registro:${ip ?? "sem-ip"}`, LIMITE_REGISTROS_POR_HORA, HORA_MS)) {
    return erroRegistro("temporarily_unavailable", "Muitos registros deste endereço. Tente mais tarde.", 429);
  }
  await limparVencidos();
  const db = banco();
  const [{ recentes }] = await db
    .select({ recentes: count() })
    .from(oauthClientes)
    .leftJoin(conexoes, eq(conexoes.clienteId, oauthClientes.id))
    .where(and(gte(oauthClientes.criadoEm, new Date(Date.now() - 24 * HORA_MS)), isNull(conexoes.id)));
  if (recentes >= TETO_CLIENTES_SEM_CONEXAO_24H) {
    return erroRegistro("temporarily_unavailable", "Registro de cliente suspenso por excesso. Tente mais tarde.", 429);
  }

  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(texto || "{}");
  } catch {
    return erroRegistro("invalid_client_metadata", "O corpo precisa ser JSON.");
  }
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return erroRegistro("invalid_client_metadata", "O corpo precisa ser um objeto JSON.");

  const redirectUris = dados.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 5) {
    return erroRegistro("invalid_redirect_uri", "Informe de 1 a 5 redirect_uris.");
  }
  if (!redirectUris.every((uri) => redirectPermitido(uri))) {
    return erroRegistro(
      "invalid_redirect_uri",
      "Endereço de retorno não permitido. Este servidor só devolve o código para o Claude (claude.ai/claude.com) e para o Claude Code (http://localhost:<porta>/callback).",
    );
  }
  if ((dados.token_endpoint_auth_method ?? "none") !== "none") {
    return erroRegistro("invalid_client_metadata", 'Só cliente público é aceito (token_endpoint_auth_method "none").');
  }
  const grantTypes = listaDeTexto(dados.grant_types, ["authorization_code", "refresh_token"]);
  if (!grantTypes || grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return erroRegistro("invalid_client_metadata", "grant_types aceitos: authorization_code e refresh_token.");
  }
  const responseTypes = listaDeTexto(dados.response_types, ["code"]);
  if (!responseTypes || responseTypes.some((r) => r !== "code")) return erroRegistro("invalid_client_metadata", "response_types aceito: code.");

  const nome = typeof dados.client_name === "string" ? dados.client_name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const [cliente] = await db
    .insert(oauthClientes)
    .values({ clientId: novoId(24), nome, redirectUris: [...new Set(redirectUris as string[])], ipRegistro: ip })
    .returning();
  return json(
    {
      client_id: cliente.clientId,
      client_id_issued_at: Math.floor(cliente.criadoEm.getTime() / 1000),
      client_name: cliente.nome,
      redirect_uris: cliente.redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: "none",
    },
    201,
    SEM_CACHE,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// /oauth2/authorize
// ---------------------------------------------------------------------------------------------------------------

export async function autorizar(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const base = basePublica(request);
  const clientId = q.get("client_id") ?? "";
  const [cliente] = clientId ? await banco().select().from(oauthClientes).where(eq(oauthClientes.clientId, clientId)).limit(1) : [];
  if (!cliente) {
    return paginaDeErro("Este cadastro do Claude não foi reconhecido. No Claude, remova o conector do Hub de Criativos e adicione de novo.");
  }
  const redirectUri = q.get("redirect_uri") ?? "";
  if (!redirectUri) return paginaDeErro("O pedido veio sem endereço de retorno (redirect_uri).");
  if (!cliente.redirectUris.some((r) => redirectConfere(r, redirectUri)) || !redirectPermitido(redirectUri)) {
    return paginaDeErro("O endereço de retorno deste pedido não é um dos registrados pelo Claude.");
  }

  // Daqui em diante o endereço de retorno é confiável: erro volta para ele.
  const state = q.get("state") ?? "";
  const voltaComErro = (codigo: string, descricao: string, comState = true) =>
    redirecionar(comParametros(redirectUri, { error: codigo, error_description: descricao, state: comState ? state || null : null, iss: base }));

  if (state.length > TETO_STATE) return voltaComErro("invalid_request", "state grande demais.", false);
  if (passouDoLimite(`autorizacao:${ipDaRequisicao(request) ?? "sem-ip"}`, LIMITE_AUTORIZACOES_POR_HORA, HORA_MS)) {
    return voltaComErro("temporarily_unavailable", "Muitos pedidos de conexão deste endereço. Tente mais tarde.");
  }
  if (q.get("response_type") !== "code") return voltaComErro("unsupported_response_type", "Só response_type=code.");
  const desafio = q.get("code_challenge") ?? "";
  if (!desafio) return voltaComErro("invalid_request", "PKCE obrigatório: falta code_challenge.");
  if (q.get("code_challenge_method") !== "S256") return voltaComErro("invalid_request", "PKCE obrigatório com code_challenge_method=S256.");
  if (!pkceValido(desafio)) return voltaComErro("invalid_request", "code_challenge malformado.");
  // Sem resource no pedido, vale o /mcp (cliente que não manda o parâmetro).
  const esperado = enderecoMcp(base);
  const recurso = q.get("resource");
  if (recurso && !recursoConfere(recurso, esperado)) {
    return voltaComErro("invalid_target", `Este servidor só emite token para ${esperado}.`);
  }

  await limparVencidos();
  const id = novoId(32);
  await banco()
    .insert(oauthPedidos)
    .values({
      id,
      clienteId: cliente.id,
      redirectUri,
      codeChallenge: desafio,
      state,
      escopos: normalizarEscopos(q.get("scope")),
      resource: esperado,
      expiraEm: new Date(Date.now() + VALIDADE_PEDIDO_MS),
    });
  return redirecionar(comParametros(`${base}${ROTA_CONSENTIMENTO}`, { pedido: id }));
}

// ---------------------------------------------------------------------------------------------------------------
// /oauth2/token e /oauth2/revoke
// ---------------------------------------------------------------------------------------------------------------

const erroOAuth = (e: ErroOAuth) => json({ error: e.codigo, error_description: e.descricao }, e.status, SEM_CACHE);

// Formulário (o que a RFC exige) ou JSON (o que alguns clientes mandam). Só texto e número entram.
function dadosDoCorpo(request: Request, texto: string): Record<string, string> {
  const dados: Record<string, string> = {};
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto || "{}");
    } catch {
      throw new ErroOAuth("invalid_request", "Corpo JSON inválido.");
    }
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroOAuth("invalid_request", "Corpo JSON precisa ser um objeto.");
    for (const [k, v] of Object.entries(bruto)) if (typeof v === "string" || typeof v === "number") dados[k] = String(v);
    return dados;
  }
  for (const [k, v] of new URLSearchParams(texto)) dados[k] = v;
  return dados;
}

// Casca comum de token e revogação. Toda exceção é tratada AQUI e nunca vai para o log com o corpo: o corpo destas
// rotas é código de autorização e token de renovação.
async function postOAuth(request: Request, executar: (dados: Record<string, string>) => Promise<Response>): Promise<Response> {
  const texto = await lerCorpo(request, TETO_CORPO_OAUTH);
  if (texto === null) return json({ error: "invalid_request", error_description: "Pedido grande demais." }, 413, SEM_CACHE);
  try {
    return await executar(dadosDoCorpo(request, texto));
  } catch (err) {
    if (err instanceof ErroOAuth) return erroOAuth(err);
    console.error("[conector] erro inesperado em", new URL(request.url).pathname, err instanceof Error ? err.message : "");
    return json({ error: "server_error", error_description: "Erro interno. Tente de novo." }, 500, SEM_CACHE);
  }
}

export function emitirToken(request: Request): Promise<Response> {
  return postOAuth(request, async (dados) => {
    const tipo = dados.grant_type;
    if (!tipo) throw new ErroOAuth("invalid_request", "Falta o grant_type.");
    if (tipo === "authorization_code") return json(await trocarCodigo(dados), 200, SEM_CACHE);
    if (tipo === "refresh_token") return json(await renovar(dados), 200, SEM_CACHE);
    throw new ErroOAuth("unsupported_grant_type", "grant_type aceitos: authorization_code e refresh_token.");
  });
}

export function revogar(request: Request): Promise<Response> {
  return postOAuth(request, async (dados) => {
    await revogarToken(dados);
    return new Response(null, { status: 200, headers: SEM_CACHE });
  });
}
