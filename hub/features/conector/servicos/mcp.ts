import "server-only";

import { banco } from "@/db/cliente";
import { chamadasMcp } from "@/db/schema";
import { CHAVES, SemPermissao, podeUsar } from "@/features/acesso/contrato";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { buscarUsuario } from "@/features/acesso/servicos/sessao";
import { ErroDaFerramenta, ErroDeParametro } from "@/features/conector/erros";
import {
  ESCOPO_HUB,
  NOME_DO_SERVIDOR,
  TITULO_DO_SERVIDOR,
  VERSAO_DO_SERVIDOR,
  basePublica,
  enderecoMcp,
  metadadosDoRecurso,
} from "@/features/conector/servicos/config";
import { conexaoDoToken, registrarUso, revogarConexao } from "@/features/conector/servicos/conexoes";
import { acharFerramenta, ferramentasDe, liberada } from "@/features/conector/servicos/ferramentas/catalogo";
import { TETO_RESPOSTA, type Contexto } from "@/features/conector/servicos/ferramentas/comum";
import { json, lerCorpo } from "@/features/conector/servicos/http";
import { passouDoLimite } from "@/features/conector/servicos/limites";
import { acharSegredo } from "@/features/memoria/servicos/segredos";
import { InputError } from "@/lib/server/http";

// O servidor MCP público (POST /mcp): JSON-RPC 2.0, SEM ESTADO. Cada POST traz o token e uma mensagem, e a resposta é
// um JSON único: sem SSE, sem Mcp-Session-Id. Nada de uma chamada é lembrado na próxima, e é isso que permite
// reconferir a pessoa e as chaves a cada uma.
//
// SÓ BEARER. O cookie de sessão do site é ignorado: aceitar sessão abriria a memória para qualquer página que fizesse
// o navegador de alguém logado mandar um POST.
//
// ERRO DE FERRAMENTA NÃO É ERRO DE PROTOCOLO. Argumento inválido, documento que não existe, chave que a pessoa não
// tem: tudo volta como RESULTADO com isError: true e um texto em português que o modelo lê e usa para corrigir. Erro
// JSON-RPC (-32xxx) fica para mensagem malformada e método ou ferramenta que não existe.

// A primeira é a mais nova: é a que se devolve quando o cliente pede uma que este servidor não conhece.
export const VERSOES_SUPORTADAS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const TETO_CORPO_MCP = 1024 * 1024;
// O Claude conversando faz algumas chamadas por minuto; 240 é automação (ou token vazado em laço).
export const LIMITE_CHAMADAS_POR_MINUTO = 240;
// O que vai para a auditoria de cada chamada.
const TETO_ARGUMENTO_AUDITADO = 200;
const TETO_AUDITORIA = 2_000;

// O nome da organização da conexão entra no lugar de {organizacao}: o Claude sabe de qual empresa é a memória.
const INSTRUCOES = `Este é o Hub de Criativos da organização {organizacao}: a memória da operação (regras, fluxos, dados do negócio, projetos e lições), a Biblioteca de arquivos e o Fluxo da produção.

- Antes de qualquer tarefa, chame \`instrucoes\` e siga o que ela traz.
- Use a memória: busque (\`memoria_buscar\`) antes de afirmar qualquer fato, fluxo ou dado do negócio. Sem fonte, diga que não sabe.
- Ao gravar: fatos levam data absoluta (AAAA-MM-DD), e o que não foi confirmado vai marcado como "precisa de revisão manual". Acrescente em vez de reescrever, e busque antes de criar um documento. Nunca inclua chaves, tokens ou senhas.
- Ao terminar um lote, registre o projeto (\`projeto_registrar\`) e as lições (\`licao_registrar\`).
- Entregas vão para a Biblioteca pelo \`link_de_envio\`.
- As ferramentas da lista dependem das permissões desta pessoa: se uma não aparece, ela não tem acesso.
- Responda em português do Brasil.`;

type Rpc = { status: number; corpo: Record<string, unknown> | null };

const erro = (id: unknown, codigo: number, mensagem: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code: codigo, message: mensagem } });

// O que cabe no serverInfo muda com a revisão: title entrou em 2025-06-18 e websiteUrl em 2025-11-25. Campo que a
// revisão acordada não prevê pode fazer cliente estrito recusar a resposta inteira. As revisões são datas ISO e
// ordenam como texto.
function identificacao(versao: string, base: string) {
  return {
    name: NOME_DO_SERVIDOR,
    version: VERSAO_DO_SERVIDOR,
    ...(versao >= "2025-06-18" ? { title: TITULO_DO_SERVIDOR } : {}),
    ...(versao >= "2025-11-25" ? { websiteUrl: `${base}/conector` } : {}),
  };
}

// A auditoria não pode guardar o segredo que a Memória acabou de recusar: o texto com a chave chega aqui inteiro,
// recusado ou não. Toda string em que a barreira da Memória acha segredo vira SEGREDO_REMOVIDO. A conferência é feita
// no texto INTEIRO, antes do corte: cortado, o pedaço que sobra pode não ser reconhecido e ainda vazar parte da chave.
// O nome do campo entra na conferência porque "senha=valor" só é segredo junto com o nome (argumento { senha: "..." }).
export const SEGREDO_REMOVIDO = "[segredo removido]";

const semSegredo = (texto: string, campo = "") => (acharSegredo(texto) || (campo && acharSegredo(`${campo}=${texto}`)) ? SEGREDO_REMOVIDO : texto);

function resumoDosArgumentos(args: Record<string, unknown>): string {
  try {
    const curto = JSON.stringify(args, (campo, v) => {
      if (typeof v !== "string") return v;
      const limpo = semSegredo(v, campo);
      return limpo.length > TETO_ARGUMENTO_AUDITADO ? `${limpo.slice(0, TETO_ARGUMENTO_AUDITADO)}…(${limpo.length} caracteres)` : limpo;
    });
    // Rede final: segredo que só aparece no JSON montado (ex.: no nome de um campo inventado) não entra.
    return acharSegredo(curto) ? JSON.stringify({ argumentos: SEGREDO_REMOVIDO }) : curto.slice(0, TETO_AUDITORIA);
  } catch {
    return "";
  }
}

// Uma linha na auditoria. Falha aqui não derruba a resposta ao Claude.
async function auditar(ctx: Contexto, ferramenta: string, args: Record<string, unknown>, duracaoMs: number, falha: string) {
  try {
    await banco()
      .insert(chamadasMcp)
      .values({
        usuarioId: ctx.usuario.id,
        organizacaoId: ctx.usuario.organizacao?.id ?? null,
        conexaoId: ctx.conexaoId,
        ferramenta: ferramenta.slice(0, 64),
        argumentos: resumoDosArgumentos(args),
        duracaoMs: Math.round(duracaoMs),
        // A mensagem de erro pode repetir um argumento (ex.: o slug que não existe).
        erro: falha ? semSegredo(falha).slice(0, TETO_AUDITORIA) : null,
      });
  } catch (err) {
    console.error("[conector] falha ao registrar a chamada", ferramenta, err instanceof Error ? err.message : err);
  }
}

async function chamarFerramenta(params: Record<string, unknown>, ctx: Contexto) {
  const nome = params.name;
  if (typeof nome !== "string" || !nome) throw new ErroDeParametro("Falta `name` com o nome da ferramenta.");
  const args = params.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) throw new ErroDeParametro("`arguments` precisa ser um objeto.");
  const ferramenta = acharFerramenta(nome);
  if (!ferramenta) throw new ErroDeParametro(`Ferramenta desconhecida: ${nome}`);

  const argumentos = args as Record<string, unknown>;
  const inicio = performance.now();
  let texto = "";
  let falha = "";
  // A chave é reconferida a cada execução: a lista que o Claude tem pode ser de antes de alguém tirar a permissão.
  if (!liberada(ferramenta, ctx.usuario)) {
    const rotulo = CHAVES.find((c) => c.chave === ferramenta.chave)?.rotulo ?? ferramenta.chave;
    falha = `Esta conta não tem mais acesso a "${rotulo}", então ${nome} não pode ser usada. Peça a um admin do Hub, se precisar.`;
  } else {
    try {
      texto = await ferramenta.executar(ctx, argumentos);
    } catch (err) {
      if (err instanceof ErroDaFerramenta || err instanceof InputError) falha = err.message;
      else {
        console.error(`[conector] a ferramenta ${nome} falhou:`, err instanceof Error ? err.message : err);
        falha = "Erro interno ao executar a ferramenta. Tente de novo; se persistir, avise quem cuida do Hub.";
      }
    }
  }
  // Rede de segurança: cada ferramenta já respeita o teto, mas resposta enorme quebra a conversa do outro lado.
  if (texto.length > TETO_RESPOSTA + 4_000) {
    texto = `${texto.slice(0, TETO_RESPOSTA)}\n\n[resposta cortada em ${TETO_RESPOSTA.toLocaleString("pt-BR")} caracteres: peça menos de cada vez]`;
  }
  await auditar(ctx, nome, argumentos, performance.now() - inicio, falha);
  return { content: [{ type: "text", text: falha || texto }], isError: Boolean(falha) };
}

async function executarMetodo(metodo: string, params: Record<string, unknown>, ctx: Contexto): Promise<unknown> {
  switch (metodo) {
    case "initialize": {
      const pedida = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const versao = VERSOES_SUPORTADAS.includes(pedida) ? pedida : VERSOES_SUPORTADAS[0];
      return { protocolVersion: versao, capabilities: { tools: {} }, serverInfo: identificacao(versao, ctx.base), instructions: INSTRUCOES.replace("{organizacao}", ctx.usuario.organizacao?.nome ?? "desta pessoa") };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: ferramentasDe(ctx.usuario).map((f) => f.definicao) };
    case "tools/call":
      return chamarFerramenta(params, ctx);
    default:
      return undefined;
  }
}

// (status HTTP, corpo). Corpo null = 202 sem corpo (notificação ou resposta do cliente).
export async function processar(texto: string, ctx: Contexto): Promise<Rpc> {
  let mensagem: unknown;
  try {
    mensagem = JSON.parse(texto);
  } catch {
    return { status: 400, corpo: erro(null, PARSE_ERROR, "JSON inválido.") };
  }
  if (Array.isArray(mensagem)) return { status: 400, corpo: erro(null, INVALID_REQUEST, "Lote (batch) não é suportado: envie uma mensagem por requisição.") };
  if (!mensagem || typeof mensagem !== "object" || (mensagem as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
    return { status: 400, corpo: erro(null, INVALID_REQUEST, "Mensagem JSON-RPC 2.0 inválida.") };
  }
  const m = mensagem as Record<string, unknown>;
  if (!("method" in m)) {
    // Resposta do cliente a um pedido do servidor. Este servidor não faz pedidos; só confirma o recebimento.
    if ("result" in m || "error" in m) return { status: 202, corpo: null };
    return { status: 400, corpo: erro(null, INVALID_REQUEST, "Mensagem sem `method`.") };
  }
  if (typeof m.method !== "string" || !m.method) return { status: 400, corpo: erro(null, INVALID_REQUEST, "`method` precisa ser texto.") };
  // Notificação (ex.: notifications/initialized): não tem resposta.
  if (!("id" in m)) return { status: 202, corpo: null };
  const id = m.id;
  if (!(typeof id === "string" || (typeof id === "number" && Number.isInteger(id)))) {
    return { status: 400, corpo: erro(null, INVALID_REQUEST, "`id` precisa ser texto ou número.") };
  }
  const params = m.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)) return { status: 200, corpo: erro(id, INVALID_PARAMS, "`params` precisa ser um objeto.") };
  try {
    const resultado = await executarMetodo(m.method, params as Record<string, unknown>, ctx);
    if (resultado === undefined) return { status: 200, corpo: erro(id, METHOD_NOT_FOUND, `Método não suportado: ${m.method}`) };
    return { status: 200, corpo: { jsonrpc: "2.0", id, result: resultado } };
  } catch (err) {
    if (err instanceof ErroDeParametro) return { status: 200, corpo: erro(id, INVALID_PARAMS, err.message) };
    console.error(`[conector] o método ${m.method} falhou:`, err instanceof Error ? err.message : err);
    return { status: 200, corpo: erro(id, INTERNAL_ERROR, "Erro interno.") };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A rota
// ---------------------------------------------------------------------------------------------------------------

// 401 com o endereço dos metadados: é assim que o Claude descobre onde fazer login (ele ignora o cabeçalho em 200).
function naoAutenticado(base: string, motivo?: "invalid_token") {
  const partes = [`resource_metadata="${metadadosDoRecurso(base)}"`, ...(motivo ? [`error="${motivo}"`] : []), `scope="${ESCOPO_HUB}"`];
  return json({ error: motivo ?? "unauthorized", error_description: "Conecte o Claude ao Hub de Criativos de novo." }, 401, {
    "WWW-Authenticate": `Bearer ${partes.join(", ")}`,
  });
}

export async function atenderMcp(request: Request): Promise<Response> {
  const base = basePublica(request);
  const [tipo, ...resto] = (request.headers.get("authorization") ?? "").trim().split(/\s+/);
  const token = tipo?.toLowerCase() === "bearer" ? resto.join(" ") : "";
  if (!token) return naoAutenticado(base);
  // O token é do endereço em que foi pedido (audiência): emitido para outro host, não vale aqui.
  const conexao = await conexaoDoToken(token, enderecoMcp(base));
  if (!conexao) return naoAutenticado(base, "invalid_token");

  // A pessoa como está AGORA no banco, na organização da conexão: removida ou desativada lá, a conexão cai; sem a
  // chave do conector, 403.
  const usuario = await buscarUsuario(conexao.usuarioId, conexao.organizacaoId);
  if (!usuario?.ativo) {
    await revogarConexao(conexao.id, "usuario_inativo");
    return naoAutenticado(base, "invalid_token");
  }
  if (!podeUsar(usuario, "conector_claude")) {
    return json({ error: "insufficient_scope", error_description: new SemPermissao("conector_claude").message }, 403, {
      "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${ESCOPO_HUB}", resource_metadata="${metadadosDoRecurso(base)}"`,
    });
  }
  if (passouDoLimite(`mcp:${conexao.id}`, LIMITE_CHAMADAS_POR_MINUTO, 60_000)) {
    return json({ error: "rate_limited", error_description: "Muitas chamadas seguidas desta conexão. Espere um minuto." }, 429, { "Retry-After": "60" });
  }
  const versao = request.headers.get("mcp-protocol-version");
  if (versao && !VERSOES_SUPORTADAS.includes(versao)) {
    return json(erro(null, INVALID_REQUEST, `MCP-Protocol-Version não suportada: ${versao}`), 400);
  }
  const texto = await lerCorpo(request, TETO_CORPO_MCP);
  if (texto === null) return json(erro(null, INVALID_REQUEST, "Mensagem grande demais (máximo de 1 MB)."), 413);

  await registrarUso(conexao.id);
  // Tudo o que as ferramentas lerem ou gravarem é da organização da conexão.
  const { status, corpo } = await comOrganizacao(conexao.organizacaoId, () => processar(texto, { usuario, conexaoId: conexao.id, base }));
  return corpo === null ? new Response(null, { status: 202 }) : json(corpo, status);
}

export const mcpSoAceitaPost = () =>
  json({ error: "method_not_allowed", error_description: "Este servidor MCP só aceita POST: não abre fluxo SSE nem sessão." }, 405, { Allow: "POST" });
