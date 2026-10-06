import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { InputError } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

// Cliente do MCP remoto do HeyGen (mcp.heygen.com), com login OAuth da conta HeyGen.
// Pelo MCP o consumo sai dos créditos premium do plano web, não do saldo da API (HEYGEN_API_KEY).
// Tokens ficam em hub/.data/heygen-mcp.json (fora do repositório).

const MCP_URL = "https://mcp.heygen.com/mcp/v1/";
const RESOURCE = "https://mcp.heygen.com/mcp/v1";
// Servidor de autorização (mcp.heygen.com/.well-known/oauth-authorization-server).
const OAUTH = {
  register: "https://api2.heygen.com/v1/oauth/register",
  authorize: "https://api2.heygen.com/v1/oauth/authorize",
  token: "https://api2.heygen.com/v1/oauth/token",
  userinfo: "https://api2.heygen.com/v1/oauth/userinfo",
};
const SCOPE = "openid profile email";
const PROTOCOL = "2025-06-18";
const STORE = path.join(DATA_DIR, "heygen-mcp.json");

// Sessão de outro servidor (ex.: o hub na nuvem): gerada aqui com ?para=nuvem e guardada à parte, para não derrubar
// a sessão desta máquina (o HeyGen troca o refresh token a cada renovação, então cada servidor precisa da sua).
const OTHER_STORE = path.join(DATA_DIR, "heygen-mcp-nuvem.json");

type Saved = {
  client?: { id: string; redirectUri: string };
  pending?: { state: string; verifier: string; returnTo: string; createdAt: number; slot?: "nuvem" };
  tokens?: { access: string; refresh: string | null; expiresAt: number };
  account?: { email: string | null; name: string | null };
  // Arquivo do hub (.data/media) → asset_id no HeyGen, para não subir o mesmo vídeo duas vezes.
  assets?: Record<string, string>;
};

export class HeyGenNotConnected extends InputError {
  constructor(detail = "") {
    super(`O HeyGen (MCP) não está conectado neste servidor${detail ? ` (${detail})` : ""}. Peça para quem administra o hub configurar a conexão.`);
  }
}

async function load(): Promise<Saved> {
  let saved: Saved = {};
  try {
    saved = JSON.parse(await readFile(STORE, "utf8")) as Saved;
  } catch {}
  // Arquivo com login: ele vale (guarda as renovações do token).
  if (saved.tokens) return saved;
  // Servidor novo (ex.: Railway) ou arquivo sem login (de uma tentativa antiga): a sessão vem da variável
  // HEYGEN_MCP_SESSION (base64 do JSON) e passa a ficar no arquivo.
  // Sem BOM nem espaços: o PowerShell coloca um BOM (U+FEFF) no começo ao enviar o valor por --stdin.
  const seed = process.env.HEYGEN_MCP_SESSION?.replace(/^﻿/, "").replace(/\s+/g, "");
  if (!seed) return saved;
  try {
    const s = JSON.parse(Buffer.from(seed, "base64").toString("utf8")) as Saved;
    if (!s.tokens) return saved;
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STORE, JSON.stringify(s, null, 1));
    return s;
  } catch {
    return saved;
  }
}

async function save(patch: Partial<Saved>) {
  const next = { ...(await load()), ...patch };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE, JSON.stringify(next, null, 1));
  return next;
}

const b64url = (b: Buffer) => b.toString("base64url");

export async function connectionStatus() {
  const s = await load();
  return { connected: Boolean(s.tokens), account: s.account ?? null };
}

// 1º passo do login: registra o hub como cliente (uma vez por endereço) e devolve a URL de autorização.
export async function startLogin(origin: string, returnTo: string, slot?: "nuvem"): Promise<string> {
  const redirectUri = `${origin}/api/heygen/mcp/callback`;
  let { client } = await load();
  if (!client || client.redirectUri !== redirectUri) {
    const res = await fetch(OAUTH.register, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Hub de Criativos",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPE,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { client_id?: string; error_description?: string };
    if (!res.ok || !data.client_id) throw new Error(`HeyGen recusou o registro do hub: ${data.error_description ?? res.status}`);
    client = { id: data.client_id, redirectUri };
  }
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  await save({ client, pending: { state, verifier, returnTo, createdAt: Date.now(), ...(slot ? { slot } : {}) } });
  const url = new URL(OAUTH.authorize);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.id,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    resource: RESOURCE,
  }).toString();
  return url.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(OAUTH.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? `HeyGen respondeu ${res.status}`);
  return data;
}

// 2º passo: o HeyGen volta para /api/heygen/mcp/callback com o código; troca por tokens. Devolve para onde voltar.
export async function finishLogin(code: string, state: string): Promise<string> {
  const s = await load();
  if (!s.client || !s.pending || s.pending.state !== state) throw new InputError("Login do HeyGen expirado. Tente conectar de novo.");
  const data = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: s.client.redirectUri,
    client_id: s.client.id,
    code_verifier: s.pending.verifier,
    resource: RESOURCE,
  });
  const tokens = { access: data.access_token!, refresh: data.refresh_token ?? null, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  let account: Saved["account"] = { email: null, name: null };
  try {
    const info = (await (await fetch(OAUTH.userinfo, { headers: { Authorization: `Bearer ${tokens.access}` } })).json()) as { email?: string; name?: string };
    account = { email: info.email ?? null, name: info.name ?? null };
  } catch {}
  if (s.pending.slot === "nuvem") {
    // Sessão para o outro servidor: fica à parte (a desta máquina continua igual).
    await writeFile(OTHER_STORE, JSON.stringify({ client: s.client, tokens, account }, null, 1));
    await save({ pending: undefined });
    return s.pending.returnTo;
  }
  session = null;
  await save({ tokens, account, pending: undefined });
  return s.pending.returnTo;
}

export async function disconnect() {
  session = null;
  await save({ tokens: undefined, account: undefined, assets: {} });
}

let refreshing: Promise<string> | null = null;

async function accessToken(force = false): Promise<string> {
  const s = await load();
  if (!s.tokens) throw new HeyGenNotConnected();
  if (!force && s.tokens.expiresAt - Date.now() > 60_000) return s.tokens.access;
  if (!s.tokens.refresh || !s.client) {
    await save({ tokens: undefined });
    throw new HeyGenNotConnected("o login expirou");
  }
  refreshing ??= (async () => {
    try {
      const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.tokens!.refresh!, client_id: s.client!.id, resource: RESOURCE });
      const tokens = { access: data.access_token!, refresh: data.refresh_token ?? s.tokens!.refresh, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
      await save({ tokens });
      return tokens.access;
    } catch {
      await save({ tokens: undefined });
      throw new HeyGenNotConnected("o login expirou");
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------- Protocolo MCP (Streamable HTTP) ----------

let session: { id: string | null } | null = null;
let nextId = 1;

type RpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

// A resposta vem como JSON ou como SSE (linhas "data: {...}").
async function readRpc(res: Response, id: number): Promise<RpcResponse | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const events = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5).trim()) as RpcResponse;
        } catch {
          return null;
        }
      });
    return events.find((e) => e?.id === id) ?? null;
  }
  return JSON.parse(text) as RpcResponse;
}

async function post(body: object, token: string) {
  return fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
      ...(session?.id ? { "Mcp-Session-Id": session.id } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

async function initialize(token: string) {
  session = null;
  const id = nextId++;
  const res = await post(
    { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "hub-criativos", version: "1.0" } } },
    token,
  );
  if (res.status === 401) throw Object.assign(new Error("401"), { unauthorized: true });
  if (!res.ok) throw new Error(`MCP do HeyGen respondeu ${res.status} ao conectar.`);
  await readRpc(res, id);
  session = { id: res.headers.get("mcp-session-id") };
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, token).catch(() => {});
}

async function rpc(method: string, params: object, attempt = 0): Promise<unknown> {
  const token = await accessToken(attempt > 0);
  try {
    if (!session) await initialize(token);
    const id = nextId++;
    const res = await post({ jsonrpc: "2.0", id, method, params }, token);
    if (res.status === 401) throw Object.assign(new Error("401"), { unauthorized: true });
    // Sessão expirada no servidor: reconecta uma vez.
    if (res.status === 404 && attempt === 0) {
      session = null;
      return rpc(method, params, 1);
    }
    if (!res.ok) throw new Error(`MCP do HeyGen respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const msg = await readRpc(res, id);
    if (!msg) throw new Error("MCP do HeyGen não respondeu.");
    if (msg.error) throw new Error(`HeyGen: ${msg.error.message ?? "erro"}`);
    return msg.result;
  } catch (err) {
    if ((err as { unauthorized?: boolean }).unauthorized) {
      session = null;
      if (attempt === 0) return rpc(method, params, 1); // renova o token e tenta de novo
      throw new HeyGenNotConnected("o HeyGen recusou o login");
    }
    throw err;
  }
}

// Chama uma ferramenta do MCP e devolve o JSON do resultado.
export async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await rpc("tools/call", { name, arguments: args })) as {
    content?: { type: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n").trim();
  if (result.isError) throw new Error(`HeyGen: ${text.slice(0, 400) || "erro"}`);
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { text } as T;
  }
}

// Sobe um arquivo do hub para o HeyGen (upload direto ao S3 assinado pelo MCP) e devolve o asset_id.
export async function uploadAsset(filePath: string, fileKey: string, contentType: string): Promise<string> {
  const cached = (await load()).assets?.[fileKey];
  if (cached) return cached;
  const bytes = await readFile(filePath);
  const up = await callTool<{ asset_id: string; upload_url: string; upload_headers?: Record<string, string>; max_bytes?: number }>("create_asset_upload", {
    filename: path.basename(filePath),
    contentType,
    sizeBytes: bytes.length,
  });
  if (up.max_bytes && bytes.length > up.max_bytes) throw new InputError(`Arquivo grande demais para o HeyGen (máx. ${Math.round(up.max_bytes / 1024 / 1024)} MB).`);
  const put = await fetch(up.upload_url, { method: "PUT", headers: { "content-type": contentType, ...up.upload_headers }, body: bytes });
  if (!put.ok) throw new Error(`Falhou o envio do arquivo ao HeyGen (${put.status}).`);
  await callTool("complete_asset_upload", { assetId: up.asset_id });
  const s = await load();
  await save({ assets: { ...s.assets, [fileKey]: up.asset_id } });
  return up.asset_id;
}
