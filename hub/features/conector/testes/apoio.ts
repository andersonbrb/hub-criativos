import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { expect, vi } from "vitest";

import { POST as autorizarPedido } from "@/app/api/conector/pedidos/[id]/autorizar/route";
import { POST as recusarPedido } from "@/app/api/conector/pedidos/[id]/recusar/route";
import { POST as rotaMcp } from "@/app/mcp/route";
import { GET as rotaAuthorize } from "@/app/oauth2/authorize/route";
import { POST as rotaRegister } from "@/app/oauth2/register/route";
import { POST as rotaRevoke } from "@/app/oauth2/revoke/route";
import { POST as rotaToken } from "@/app/oauth2/token/route";
import { banco } from "@/db/cliente";
import { bancoDeTeste } from "@/db/teste";
import { usuarios } from "@/db/schema";
import { ORGANIZACAO_PADRAO, type Chave, type Papel } from "@/features/acesso/contrato";
import { garantirOrganizacaoPadrao, mudarVinculo, vincular } from "@/features/acesso/testes/ajuda";
import { zerarLimites } from "@/features/conector/servicos/limites";
import { zerarLimpeza } from "@/features/conector/servicos/limpeza";
import { sessao } from "@/features/conector/testes/sessao-falsa";

// O caminho que o Claude percorre, chamando os route handlers de verdade com objetos Request: registro, authorize,
// consentimento, token e /mcp.

export const BASE = "https://hub.teste";
export const ENDERECO_MCP = `${BASE}/mcp`;
export const REDIRECT_CLAUDE = "https://claude.ai/api/mcp/auth_callback";
export const REDIRECT_CLAUDE_COM = "https://claude.com/api/mcp/auth_callback";
export const REDIRECT_CODE = "http://localhost:33418/callback";

export async function prepararTeste() {
  // A trilha de auditoria (console.info) só sujaria a saída dos testes.
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  process.env.HUB_PUBLIC_URL = BASE;
  delete process.env.MCP_REDIRECTS_PERMITIDOS;
  sessao.logado = null;
  sessao.organizacao = ORGANIZACAO_PADRAO.id;
  zerarLimites();
  zerarLimpeza();
  await bancoDeTeste();
  await garantirOrganizacaoPadrao();
}

// (verificador, desafio S256)
export function pkce() {
  const verificador = randomBytes(48).toString("base64url");
  return { verificador, desafio: createHash("sha256").update(verificador).digest("base64url") };
}

export const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

// Pessoa na organização padrão (ou na pedida), com as chaves dadas.
export async function criarPessoa({ chaves = ["conector_claude"] as Chave[], nome = "Sávio", ativo = true, organizacaoId = ORGANIZACAO_PADRAO.id as string } = {}) {
  const [u] = await banco()
    .insert(usuarios)
    .values({ email: `${nome.toLowerCase().replace(/\W/g, "")}${randomBytes(3).toString("hex")}@exemplo.com`, nome })
    .returning();
  await vincular(u.id, organizacaoId, { chaves, ativo });
  return u;
}

// Papel, chaves e situação mudam no vínculo com a organização padrão; o resto, na conta.
export async function mudarPessoa(id: string, dados: { papel?: Papel; chaves?: Chave[]; ativo?: boolean; nome?: string }) {
  const { nome, ...vinculo } = dados;
  if (nome !== undefined) await banco().update(usuarios).set({ nome }).where(eq(usuarios.id, id));
  if (Object.keys(vinculo).length) await mudarVinculo(id, vinculo);
}

// ---- OAuth ----

// cabecalhos substitui o IP padrão (ex.: X-Forwarded-For com um IP forjado na frente).
export function registrar(redirectUris: string[] = [REDIRECT_CLAUDE], extra: Record<string, unknown> = {}, cabecalhos: Record<string, string> = {}) {
  return rotaRegister(
    new Request(`${BASE}/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1", ...cabecalhos },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris, ...extra }),
    }),
  );
}

export async function clientId(redirectUris: string[] = [REDIRECT_CLAUDE]) {
  const res = await registrar(redirectUris);
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

export function authorize(cliente: string, redirectUri = REDIRECT_CLAUDE, desafio?: string, extra: Record<string, string | null> = {}) {
  const params: Record<string, string | null> = {
    response_type: "code",
    client_id: cliente,
    redirect_uri: redirectUri,
    code_challenge: desafio ?? pkce().desafio,
    code_challenge_method: "S256",
    state: "estado-123",
    scope: "hub.memoria offline_access",
    resource: ENDERECO_MCP,
    ...extra,
  };
  const q = new URLSearchParams(Object.entries(params).filter((p): p is [string, string] => p[1] !== null));
  return rotaAuthorize(new Request(`${BASE}/oauth2/authorize?${q}`, { headers: { "x-forwarded-for": "10.0.0.2" } }));
}

export async function novoPedido(cliente?: string, redirectUri = REDIRECT_CLAUDE, desafio?: string) {
  const res = await authorize(cliente ?? (await clientId([redirectUri])), redirectUri, desafio);
  expect(res.status).toBe(302);
  const destino = res.headers.get("location")!;
  expect(destino.startsWith(`${BASE}/conectar-claude?pedido=`)).toBe(true);
  return query(destino).pedido;
}

// A pessoa logada (ou ninguém, com null) responde o pedido na tela de consentimento.
export function decidir(pessoaId: string | null, pedido: string, decisao: "autorizar" | "recusar" = "autorizar") {
  sessao.logado = pessoaId;
  const rota = decisao === "autorizar" ? autorizarPedido : recusarPedido;
  return rota(new Request(`${BASE}/api/conector/pedidos/${pedido}/${decisao}`, { method: "POST", headers: { "x-forwarded-for": "10.0.0.3" } }), {
    params: Promise.resolve({ id: pedido }),
  });
}

export function token(dados: Record<string, string>, comoJson = false) {
  return rotaToken(
    new Request(`${BASE}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": comoJson ? "application/json" : "application/x-www-form-urlencoded" },
      body: comoJson ? JSON.stringify(dados) : new URLSearchParams(dados).toString(),
    }),
  );
}

export function revogar(dados: Record<string, string>) {
  return rotaRevoke(
    new Request(`${BASE}/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(dados).toString(),
    }),
  );
}

// Registro + authorize + consentimento. Devolve o que o Claude tem nas mãos antes de pedir o token.
export async function codigoAutorizado(pessoaId: string, redirectUri = REDIRECT_CLAUDE) {
  const { verificador, desafio } = pkce();
  const cliente = await clientId([redirectUri]);
  const pedido = await novoPedido(cliente, redirectUri, desafio);
  const res = await decidir(pessoaId, pedido);
  expect(res.status).toBe(200);
  sessao.logado = null;
  const { redirect } = (await res.json()) as { redirect: string };
  return { cliente, verificador, codigo: query(redirect).code, redirect };
}

export type Tokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };

// O fluxo inteiro: devolve os tokens e o client_id.
export async function conectar(pessoaId: string, redirectUri = REDIRECT_CLAUDE) {
  const { cliente, verificador, codigo } = await codigoAutorizado(pessoaId, redirectUri);
  const res = await token({
    grant_type: "authorization_code",
    code: codigo,
    redirect_uri: redirectUri,
    client_id: cliente,
    code_verifier: verificador,
    resource: ENDERECO_MCP,
  });
  expect(res.status).toBe(200);
  return { ...((await res.json()) as Tokens), cliente, redirectUri };
}

// ---- MCP ----

export function mcp(acesso: string | null, metodo: string, params?: unknown, id: string | number | null = 1, headers: Record<string, string> = {}) {
  const mensagem: Record<string, unknown> = { jsonrpc: "2.0", method: metodo };
  if (id !== null) mensagem.id = id;
  if (params !== undefined) mensagem.params = params;
  return mcpCru(acesso, JSON.stringify(mensagem), headers);
}

export function mcpCru(acesso: string | null, corpo: string, headers: Record<string, string> = {}) {
  return rotaMcp(
    new Request(ENDERECO_MCP, {
      method: "POST",
      headers: { "content-type": "application/json", ...(acesso ? { authorization: `Bearer ${acesso}` } : {}), ...headers },
      body: corpo,
    }),
  );
}

export type Resultado = { content: { type: string; text: string }[]; isError: boolean };

// tools/call e devolve o result (content + isError).
export async function chamar(acesso: string, ferramenta: string, args: Record<string, unknown> = {}): Promise<Resultado & { texto: string }> {
  const res = await mcp(acesso, "tools/call", { name: ferramenta, arguments: args });
  expect(res.status).toBe(200);
  const corpo = (await res.json()) as { result?: Resultado; error?: unknown };
  expect(corpo.result, JSON.stringify(corpo)).toBeDefined();
  return { ...corpo.result!, texto: corpo.result!.content[0].text };
}

export async function nomesDasFerramentas(acesso: string) {
  const res = await mcp(acesso, "tools/list");
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
}
