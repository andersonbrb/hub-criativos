import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { createMcpClient, MCP_SERVICES, McpNotConnected } from "@/lib/server/mcp-client";
import { usarRaizDosDados } from "@/lib/server/pastas";

// Login das integrações pelo MCP (ElevenLabs, FLORA, HeyGen): o cartão mostra a situação de verdade, a lixeira
// apaga de vez e o login antigo da variável do servidor não volta depois de desconectar ou vencer.

const cfg = MCP_SERVICES.elevenlabs;
const VARIAVEL = "ELEVENLABS_MCP_SESSION";
const original = process.env[VARIAVEL];
let pasta: string;

const sessao = (expiraEm: number) => ({ client: { id: "cliente", redirectUri: "https://hub.teste/cb" }, tokens: { access: "acesso-velho", refresh: "renovar", expiresAt: expiraEm } });
const naVariavel = (s: object) => (process.env[VARIAVEL] = Buffer.from(JSON.stringify(s)).toString("base64"));
const arquivo = () => path.join(pasta, "elevenlabs-mcp.json");
const json = (status: number, corpo: object) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

// O que o serviço responde: no pedido de token e no MCP.
function servico({ token, mcp }: { token: () => Response | Promise<Response>; mcp?: () => Response }) {
  const chamadas: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      chamadas.push(u);
      if (u === cfg.token) return token();
      if (u === cfg.mcpUrl && mcp) return mcp();
      throw new Error(`pedido inesperado: ${u}`);
    }),
  );
  return chamadas;
}

beforeEach(async () => {
  pasta = await mkdtemp(path.join(os.tmpdir(), "hub-login-mcp-"));
  usarRaizDosDados(pasta);
  delete process.env[VARIAVEL];
});
afterEach(async () => {
  usarRaizDosDados(undefined);
  if (original === undefined) delete process.env[VARIAVEL];
  else process.env[VARIAVEL] = original;
  vi.unstubAllGlobals();
  await rm(pasta, { recursive: true, force: true });
});

describe("integrações: login pelo MCP", () => {
  it("sem nada guardado, fica desconectada", async () => {
    const c = createMcpClient(cfg, ORGANIZACAO_PADRAO.id);
    expect(await c.connectionStatus()).toMatchObject({ connected: false, situacao: "desconectada" });
  });

  it("o login antigo da variável entra uma vez, e a lixeira apaga de vez", async () => {
    naVariavel(sessao(Date.now() + 3_600_000));
    const c = createMcpClient(cfg, ORGANIZACAO_PADRAO.id);
    expect(await c.connectionStatus()).toMatchObject({ connected: true, situacao: "ativa" });

    await c.disconnect();
    // A variável continua lá, mas não volta.
    expect(await c.connectionStatus()).toMatchObject({ connected: false, situacao: "desconectada" });
    expect(await createMcpClient(cfg, ORGANIZACAO_PADRAO.id).connectionStatus()).toMatchObject({ situacao: "desconectada" });
  });

  it("login que o serviço não renova aparece vencido, sem voltar da variável", async () => {
    naVariavel(sessao(Date.now() - 86_400_000));
    servico({ token: () => json(400, { error: "invalid_grant" }) });
    const c = createMcpClient(cfg, ORGANIZACAO_PADRAO.id);

    expect(await c.connectionStatus()).toMatchObject({ connected: false, situacao: "vencida" });
    expect(await c.connectionStatus()).toMatchObject({ situacao: "vencida" });
    await expect(c.callTool("qualquer")).rejects.toThrow(/o login expirou/);

    await c.disconnect();
    expect(await c.connectionStatus()).toMatchObject({ situacao: "desconectada" });
  });

  it("falha de rede na renovação não derruba o login", async () => {
    await writeFile(arquivo(), JSON.stringify(sessao(Date.now() - 1000)));
    let fora = true;
    servico({ token: () => (fora ? Promise.reject(new TypeError("fetch failed")) : json(200, { access_token: "novo", refresh_token: "renovar-2", expires_in: 3600 })) });
    const c = createMcpClient(cfg, ORGANIZACAO_PADRAO.id);

    expect(await c.connectionStatus()).toMatchObject({ situacao: "ativa" });
    expect(JSON.parse(await readFile(arquivo(), "utf8")).tokens.refresh).toBe("renovar");

    fora = false;
    expect(await c.connectionStatus()).toMatchObject({ situacao: "ativa" });
    const salvo = JSON.parse(await readFile(arquivo(), "utf8"));
    expect(salvo.tokens).toMatchObject({ access: "novo", refresh: "renovar-2" });
    expect(salvo.tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("serviço que recusa até o token renovado deixa a conexão vencida", async () => {
    await writeFile(arquivo(), JSON.stringify(sessao(Date.now() + 3_600_000)));
    servico({ token: () => json(200, { access_token: "novo", expires_in: 3600 }), mcp: () => new Response("", { status: 401 }) });
    const c = createMcpClient(cfg, ORGANIZACAO_PADRAO.id);

    await expect(c.callTool("qualquer")).rejects.toBeInstanceOf(McpNotConnected);
    expect(await c.connectionStatus()).toMatchObject({ situacao: "vencida" });
  });

  it("conectar de novo depois de vencer volta a ficar ativa", async () => {
    naVariavel(sessao(Date.now() - 86_400_000));
    let token = () => json(400, { error: "invalid_grant" });
    servico({ token: () => token() });
    const c = createMcpClient(cfg, ORGANIZACAO_PADRAO.id);
    expect(await c.connectionStatus()).toMatchObject({ situacao: "vencida" });

    const url = new URL(await c.startLogin("https://hub.teste", "/integracoes"));
    token = () => json(200, { access_token: "da-tela", refresh_token: "r", expires_in: 3600 });
    expect(await c.finishLogin("codigo", url.searchParams.get("state")!)).toBe("/integracoes");

    expect(await c.connectionStatus()).toMatchObject({ connected: true, situacao: "ativa" });
    const salvo = JSON.parse(await readFile(arquivo(), "utf8"));
    expect(salvo.tokens.access).toBe("da-tela");
    expect(salvo.vencidoEm).toBeUndefined();
  });
});
