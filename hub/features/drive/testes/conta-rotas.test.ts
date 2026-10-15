import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as rotaVolta } from "@/app/api/integracoes/google-drive/callback/route";
import { GET as rotaEntrar } from "@/app/api/integracoes/google-drive/login/route";
import { DELETE as rotaDesconectar, GET as rotaStatus } from "@/app/api/integracoes/google-drive/status/route";
import { banco } from "@/db/cliente";
import { driveConta } from "@/db/schema";
import { paraUsuario } from "@/features/acesso/servicos/usuarios";
import { contaConectada, criarPessoa, googleFalso, json, ORIGEM, prepararConta, tokensDoGoogle } from "@/features/drive/testes/conta-apoio";

// As rotas do card do Google Drive chamadas de verdade, com um login de mentira (a pessoa "logada" fica em sessao).
const sessao = vi.hoisted(() => ({ logado: null as import("@/features/acesso/contrato").Usuario | null }));
vi.mock("@/features/acesso/servicos/sessao", async () => {
  const { NaoAutenticado, SemPermissao, podeUsar } = await import("@/features/acesso/contrato");
  return {
    exigirUsuario: async (chave?: import("@/features/acesso/contrato").Chave) => {
      if (!sessao.logado) throw new NaoAutenticado();
      if (chave && !podeUsar(sessao.logado, chave)) throw new SemPermissao(chave);
      return sessao.logado;
    },
  };
});

const pedir = (caminho: string, init?: RequestInit) => new Request(`${ORIGEM}${caminho}`, init);
const destino = (res: Response) => res.headers.get("location") ?? "";

async function entrarComo(chaves: Parameters<typeof criarPessoa>[0]) {
  const pessoa = await criarPessoa(chaves);
  sessao.logado = paraUsuario(pessoa);
  return pessoa;
}

beforeEach(async () => {
  await prepararConta();
  sessao.logado = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("drive: rotas da conta", () => {
  it("só quem tem a chave Integrações conecta, desconecta e lê o status", async () => {
    expect((await rotaEntrar(pedir("/api/integracoes/google-drive/login"))).status).toBe(401);
    await entrarComo(["biblioteca"]);
    expect((await rotaEntrar(pedir("/api/integracoes/google-drive/login"))).status).toBe(403);
    expect((await rotaVolta(pedir("/api/integracoes/google-drive/callback?code=x&state=y"))).status).toBe(403);
    expect((await rotaDesconectar(pedir("/api/integracoes/google-drive/status", { method: "DELETE" }))).status).toBe(403);
    expect((await rotaStatus(pedir("/api/integracoes/google-drive/status"))).status).toBe(403);
  });

  it("Conectar leva ao Google e a volta grava a conta e retorna para Integrações", async () => {
    googleFalso({ token: () => tokensDoGoogle(), perfil: () => json({ email: "videos@gmail.com", name: "Vídeos" }) });
    await entrarComo(["integracoes"]);

    const ida = await rotaEntrar(pedir(`/api/integracoes/google-drive/login?volta=${encodeURIComponent("https://site-falso.com")}`));
    expect(ida.status).toBe(302);
    const google = new URL(destino(ida));
    expect(google.host).toBe("accounts.google.com");

    const volta = await rotaVolta(pedir(`/api/integracoes/google-drive/callback?code=codigo&state=${google.searchParams.get("state")}`));
    expect(volta.status).toBe(303);
    expect(destino(volta)).toBe("/integracoes?drive=conectado");
    expect(await banco().select().from(driveConta)).toHaveLength(1);
  });

  it("cancelar no Google, state errado ou servidor sem chave voltam ao card com o aviso certo", async () => {
    await entrarComo(["integracoes"]);
    const cancelado = await rotaVolta(pedir("/api/integracoes/google-drive/callback?error=access_denied&state=x"));
    expect(destino(cancelado)).toBe("/integracoes?drive=erro&motivo=cancelado");

    const inventado = await rotaVolta(pedir("/api/integracoes/google-drive/callback?code=x&state=inventado"));
    expect(destino(inventado)).toBe("/integracoes?drive=erro&motivo=pedido-vencido");

    delete process.env.HUB_CHAVE_SEGREDOS;
    const semChave = await rotaEntrar(pedir("/api/integracoes/google-drive/login"));
    expect(semChave.status).toBe(303);
    expect(destino(semChave)).toBe("/integracoes?drive=erro&motivo=configuracao");
  });

  it("Desconectar revoga, apaga e devolve o status novo; pedido de outro site é recusado", async () => {
    googleFalso({ revogar: () => json({}), sobre: () => json({ storageQuota: { usage: "1", limit: "2" } }) });
    await contaConectada(30 * 60_000);
    await entrarComo(["integracoes"]);

    const deFora = await rotaDesconectar(pedir("/api/integracoes/google-drive/status", { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } }));
    expect(deFora.status).toBe(403);
    expect(await banco().select().from(driveConta)).toHaveLength(1);

    const res = await rotaDesconectar(pedir("/api/integracoes/google-drive/status", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configurado: true, conectado: false, conta: null, espaco: null, falta: null });
    expect(await banco().select().from(driveConta)).toHaveLength(0);
  });
});
