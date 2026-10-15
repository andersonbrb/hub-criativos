import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { InputError, route } from "@/lib/server/http";

// Fora de um pedido do Next não há cookies: a sessão lê sempre o cookie (sessao.ts), então o teste entrega um vazio.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const URL_DO_HUB = "http://hub.local/api/teste";

describe("lerCorpo (rotas de acesso)", () => {
  it("lê JSON, formulário simples e formulário multipart", async () => {
    const json = new Request(URL_DO_HUB, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ana@exemplo.com" }) });
    expect(await lerCorpo(json)).toEqual({ dados: { email: "ana@exemplo.com" }, formulario: false });

    const simples = new Request(URL_DO_HUB, { method: "POST", body: new URLSearchParams({ email: "ana@exemplo.com", senha: "ç é ã" }) });
    expect(await lerCorpo(simples)).toEqual({ dados: { email: "ana@exemplo.com", senha: "ç é ã" }, formulario: true });

    const form = new FormData();
    form.set("nome", "Ana Lúcia");
    const multipart = new Request(URL_DO_HUB, { method: "POST", body: form });
    expect(await lerCorpo(multipart)).toEqual({ dados: { nome: "Ana Lúcia" }, formulario: true });

    expect(await lerCorpo(new Request(URL_DO_HUB, { method: "POST" }))).toEqual({ dados: {}, formulario: false });
  });

  it("recusa corpo acima de 16 KB, mesmo sem Content-Length", async () => {
    const grande = JSON.stringify({ email: "x".repeat(17 * 1024) });
    const semTamanho = new Request(URL_DO_HUB, { method: "POST", body: grande });
    expect(semTamanho.headers.get("content-length")).toBeNull();
    await expect(lerCorpo(semTamanho)).rejects.toThrow("Pedido grande demais.");
    await expect(lerCorpo(new Request(URL_DO_HUB, { method: "POST", headers: { "Content-Length": String(grande.length) }, body: grande }))).rejects.toThrow(
      InputError,
    );
    const formGrande = new Request(URL_DO_HUB, { method: "POST", body: new URLSearchParams({ senha: "x".repeat(17 * 1024) }) });
    await expect(lerCorpo(formGrande)).rejects.toThrow("Pedido grande demais.");
  });
});

describe("route(): pedido vindo de outro site", () => {
  // Sem banco e fora do Railway, a sessão é a do dono local: o teste olha só a trava de origem.
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const pedido = (method: string, site?: string) => new Request(URL_DO_HUB, { method, headers: site ? { "Sec-Fetch-Site": site } : {} });
  const responde = async (pedido: Request) => Response.json({ ok: true, metodo: pedido.method });
  const rota = route(responde);
  const aberta = route(responde, { publica: true });

  it("recusa POST, PATCH e DELETE de outro site com 403", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      for (const site of ["cross-site", "same-site"]) {
        const resposta = await rota(pedido(method, site));
        expect(resposta.status).toBe(403);
        expect((await resposta.json()).error).toMatch(/outro site/);
      }
    }
  });

  it("deixa passar o próprio hub, a barra de endereço, quem não manda o cabeçalho e as leituras", async () => {
    expect((await rota(pedido("POST", "same-origin"))).status).toBe(200);
    expect((await rota(pedido("POST", "none"))).status).toBe(200);
    expect((await rota(pedido("POST"))).status).toBe(200);
    expect((await rota(pedido("GET", "cross-site"))).status).toBe(200);
    expect((await rota(pedido("HEAD", "cross-site"))).status).toBe(200);
  });

  it("rota aberta não passa pela trava do route() (as de acesso conferem por conta própria)", async () => {
    expect((await aberta(pedido("POST", "cross-site"))).status).toBe(200);
  });
});
