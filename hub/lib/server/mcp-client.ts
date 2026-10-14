import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { InputError } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

// Cliente genérico dos MCPs remotos que o hub usa no lugar das APIs (HeyGen, FLORA, ElevenLabs), com login OAuth
// da conta de cada serviço (PKCE). Pelo MCP o consumo sai dos créditos do plano de cada serviço, não do saldo da API.
// Sessão de cada serviço em hub/.data/<id>-mcp.json (fora do repositório). Num servidor novo (Railway) a sessão
// pode vir da variável <ID>_MCP_SESSION (base64 do JSON) ou de um login feito direto nele (botão em Integrações).

export type McpServiceId = "heygen" | "flora" | "elevenlabs";

type ServiceConfig = {
  id: McpServiceId;
  label: string;
  mcpUrl: string;
  resource: string;
  authorize: string;
  token: string;
  // Registro dinâmico (RFC 7591). Sem ele, o client_id é a URL pública do documento de metadados do hub (CIMD).
  register?: string;
  userinfo?: string;
  scope?: string;
};

export const MCP_SERVICES: Record<McpServiceId, ServiceConfig> = {
  heygen: {
    id: "heygen",
    label: "HeyGen",
    mcpUrl: "https://mcp.heygen.com/mcp/v1/",
    resource: "https://mcp.heygen.com/mcp/v1",
    register: "https://api2.heygen.com/v1/oauth/register",
    authorize: "https://api2.heygen.com/v1/oauth/authorize",
    token: "https://api2.heygen.com/v1/oauth/token",
    userinfo: "https://api2.heygen.com/v1/oauth/userinfo",
    scope: "openid profile email",
  },
  flora: {
    id: "flora",
    label: "FLORA",
    mcpUrl: "https://agents.flora.ai/mcp",
    resource: "https://agents.flora.ai/mcp",
    register: "https://agents.flora.ai/register",
    authorize: "https://agents.flora.ai/authorize",
    token: "https://agents.flora.ai/token",
  },
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs",
    mcpUrl: "https://api.elevenlabs.io/v1/mcp",
    resource: "https://api.us.elevenlabs.io/v1/mcp",
    authorize: "https://elevenlabs.io/app/oauth/authorize",
    token: "https://api.us.elevenlabs.io/v1/oauth/token",
    scope: "text_to_speech speech_history_read voice_generation flows image_video_generation",
  },
};

// Endereço público onde o ElevenLabs lê os metadados do hub (CIMD). Precisa ser HTTPS e público: o hub no Railway.
export const PUBLIC_URL = (process.env.HUB_PUBLIC_URL || "https://hub-criativos-production.up.railway.app").replace(/\/$/, "");
export const clientMetadataUrl = (id: McpServiceId) => `${PUBLIC_URL}/oauth/${id}-client.json`;
export const callbackPath = (id: McpServiceId) => `/api/integracoes/mcp/${id}/callback`;

const PROTOCOL = "2025-06-18";

type Saved = {
  client?: { id: string; redirectUri: string };
  pending?: { state: string; verifier: string; returnTo: string; createdAt: number; slot?: "nuvem"; redirectUri: string };
  tokens?: { access: string; refresh: string | null; expiresAt: number };
  account?: { email: string | null; name: string | null };
  // Arquivo do hub → id do arquivo no serviço, para não subir o mesmo arquivo duas vezes.
  assets?: Record<string, string>;
};

export class McpNotConnected extends InputError {
  constructor(label: string, detail = "") {
    super(`O ${label} (MCP) não está conectado neste servidor${detail ? ` (${detail})` : ""}. Conecte em Integrações → ${label}.`);
  }
}

type RpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

export type McpClient = ReturnType<typeof createMcpClient>;

export function createMcpClient(cfg: ServiceConfig) {
  const STORE = path.join(DATA_DIR, `${cfg.id}-mcp.json`);
  const OTHER_STORE = path.join(DATA_DIR, `${cfg.id}-mcp-nuvem.json`);
  const ENV = `${cfg.id.toUpperCase()}_MCP_SESSION`;
  const notConnected = (detail = "") => new McpNotConnected(cfg.label, detail);

  async function load(): Promise<Saved> {
    let saved: Saved = {};
    try {
      saved = JSON.parse(await readFile(STORE, "utf8")) as Saved;
    } catch {}
    if (saved.tokens) return saved;
    // Sem BOM nem espaços: o PowerShell coloca um BOM (U+FEFF) no começo ao enviar o valor por --stdin.
    const seed = process.env[ENV]?.replace(/^﻿/, "").replace(/\s+/g, "");
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

  async function connectionStatus() {
    const s = await load();
    return { connected: Boolean(s.tokens), account: s.account ?? null };
  }

  // 1º passo do login: registra o hub (registro dinâmico) ou usa o documento de metadados (CIMD) e devolve a URL de autorização.
  async function startLogin(origin: string, returnTo: string, slot?: "nuvem"): Promise<string> {
    const redirectUri = `${origin}${callbackPath(cfg.id)}`;
    let { client } = await load();
    if (!cfg.register) {
      client = { id: clientMetadataUrl(cfg.id), redirectUri };
    } else if (!client || client.redirectUri !== redirectUri) {
      const res = await fetch(cfg.register, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Hub de Criativos",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...(cfg.scope ? { scope: cfg.scope } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { client_id?: string; error_description?: string };
      if (!res.ok || !data.client_id) throw new Error(`${cfg.label} recusou o registro do hub: ${data.error_description ?? res.status}`);
      client = { id: data.client_id, redirectUri };
    }
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(16));
    await save({ client, pending: { state, verifier, returnTo, createdAt: Date.now(), redirectUri, ...(slot ? { slot } : {}) } });
    const url = new URL(cfg.authorize);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: client.id,
      redirect_uri: redirectUri,
      ...(cfg.scope ? { scope: cfg.scope } : {}),
      state,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      resource: cfg.resource,
    }).toString();
    return url.toString();
  }

  async function tokenRequest(body: Record<string, string>) {
    const res = await fetch(cfg.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? `${cfg.label} respondeu ${res.status}`);
    return data;
  }

  // 2º passo: o serviço volta para o callback com o código; troca por tokens. Devolve para onde voltar.
  async function finishLogin(code: string, state: string): Promise<string> {
    const s = await load();
    if (!s.client || !s.pending || s.pending.state !== state) throw new InputError(`Login do ${cfg.label} expirado. Tente conectar de novo.`);
    const data = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: s.pending.redirectUri ?? s.client.redirectUri,
      client_id: s.client.id,
      code_verifier: s.pending.verifier,
      resource: cfg.resource,
    });
    const tokens = { access: data.access_token!, refresh: data.refresh_token ?? null, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    let account: Saved["account"] = { email: null, name: null };
    if (cfg.userinfo) {
      try {
        const info = (await (await fetch(cfg.userinfo, { headers: { Authorization: `Bearer ${tokens.access}` } })).json()) as { email?: string; name?: string };
        account = { email: info.email ?? null, name: info.name ?? null };
      } catch {}
    }
    if (s.pending.slot === "nuvem") {
      // Sessão para outro servidor: fica à parte (a desta máquina continua igual; cada servidor renova a sua).
      await writeFile(OTHER_STORE, JSON.stringify({ client: s.client, tokens, account }, null, 1));
      await save({ pending: undefined });
      return s.pending.returnTo;
    }
    session = null;
    await save({ tokens, account, pending: undefined, assets: {} });
    return s.pending.returnTo;
  }

  async function disconnect() {
    session = null;
    await save({ tokens: undefined, account: undefined, assets: {} });
  }

  let refreshing: Promise<string> | null = null;

  async function accessToken(force = false): Promise<string> {
    const s = await load();
    if (!s.tokens) throw notConnected();
    if (!force && s.tokens.expiresAt - Date.now() > 60_000) return s.tokens.access;
    if (!s.tokens.refresh || !s.client) {
      await save({ tokens: undefined });
      throw notConnected("o login expirou");
    }
    refreshing ??= (async () => {
      try {
        const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.tokens!.refresh!, client_id: s.client!.id, resource: cfg.resource });
        const tokens = { access: data.access_token!, refresh: data.refresh_token ?? s.tokens!.refresh, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
        await save({ tokens });
        return tokens.access;
      } catch {
        await save({ tokens: undefined });
        throw notConnected("o login expirou");
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  // ---------- Protocolo MCP (Streamable HTTP) ----------

  let session: { id: string | null } | null = null;
  let nextId = 1;

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
    return fetch(cfg.mcpUrl, {
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
    if (!res.ok) throw new Error(`MCP do ${cfg.label} respondeu ${res.status} ao conectar.`);
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
      if (!res.ok) throw new Error(`MCP do ${cfg.label} respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const msg = await readRpc(res, id);
      if (!msg) throw new Error(`MCP do ${cfg.label} não respondeu.`);
      if (msg.error) throw new Error(`${cfg.label}: ${msg.error.message ?? "erro"}`);
      return msg.result;
    } catch (err) {
      if ((err as { unauthorized?: boolean }).unauthorized) {
        session = null;
        if (attempt === 0) return rpc(method, params, 1); // renova o token e tenta de novo
        throw notConnected("o serviço recusou o login");
      }
      throw err;
    }
  }

  // Chama uma ferramenta do MCP e devolve o JSON do resultado.
  async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = (await rpc("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    };
    const text = (result.content ?? []).map((c) => c.text ?? "").join("\n").trim();
    if (result.isError) throw new Error(`${cfg.label}: ${text.slice(0, 400) || "erro"}`);
    if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { text } as T;
    }
  }

  // Cache de "arquivo do hub → id no serviço" (para não subir o mesmo arquivo duas vezes).
  async function cachedAsset(key: string) {
    return (await load()).assets?.[key];
  }
  async function rememberAsset(key: string, id: string) {
    const s = await load();
    await save({ assets: { ...s.assets, [key]: id } });
  }

  // Baixa um arquivo gerado pelo serviço. Se o link pedir login, tenta de novo com o token da conta (só no domínio do serviço).
  async function download(url: string): Promise<Response> {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status !== 401 && res.status !== 403) return res;
    const host = new URL(url).hostname;
    const own = [cfg.mcpUrl, cfg.resource, cfg.token].some((u) => {
      const h = new URL(u).hostname.split(".").slice(-2).join(".");
      return host === h || host.endsWith(`.${h}`);
    });
    if (!own) return res;
    return fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${await accessToken()}` } });
  }

  return { config: cfg, connectionStatus, startLogin, finishLogin, disconnect, callTool, download, cachedAsset, rememberAsset, notConnected };
}

const clients = new Map<McpServiceId, McpClient>();

export function mcp(id: McpServiceId): McpClient {
  let c = clients.get(id);
  if (!c) {
    c = createMcpClient(MCP_SERVICES[id]);
    clients.set(id, c);
  }
  return c;
}

// Endereço público do hub (atrás de proxy, como no Railway, request.url é o endereço interno).
export function originOf(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

export const isMcpService = (id: string): id is McpServiceId => id in MCP_SERVICES;
