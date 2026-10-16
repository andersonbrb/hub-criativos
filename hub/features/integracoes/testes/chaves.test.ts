import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as rotaRemover, PUT as rotaSalvar } from "@/app/api/integracoes/chaves/[nome]/route";
import { banco } from "@/db/cliente";
import { integracoesChaves } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { usuarioNaOrganizacao } from "@/features/acesso/servicos/usuarios";
import { criarPessoa } from "@/features/drive/testes/conta-apoio";
import { apagarChave, esquecerChavesLembradas, gravarChave, lerChave, resumoDasChaves } from "@/features/integracoes/servicos/chaves";

// Chaves das integrações coladas na tela Integrações, no lugar das variáveis do servidor.

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

const CHAVE_DE_TESTE = Buffer.alloc(32, 7).toString("base64");
const VARIAVEIS = ["ANTHROPIC_API_KEY", "VENICE_API_KEY", "HUB_API_MODEL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "HUB_CHAVE_SEGREDOS"] as const;
const originais = Object.fromEntries(VARIAVEIS.map((v) => [v, process.env[v]]));

const ctx = (nome: string) => ({ params: Promise.resolve({ nome }) });
const pedido = (metodo: string, corpo?: unknown) =>
  new Request("https://hub.teste/api/integracoes/chaves/x", { method: metodo, headers: { "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });

beforeEach(async () => {
  for (const v of VARIAVEIS) delete process.env[v];
  process.env.HUB_CHAVE_SEGREDOS = CHAVE_DE_TESTE;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await bancoDeTeste();
  sessao.logado = null;
});
afterEach(() => {
  for (const v of VARIAVEIS) {
    if (originais[v] === undefined) delete process.env[v];
    else process.env[v] = originais[v];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("integrações: chaves", () => {
  it("grava cifrada, lê de volta e a tela só vê o final", async () => {
    await gravarChave("anthropic", "  sk-ant-segredo-1234  ");
    expect(await lerChave("anthropic")).toBe("sk-ant-segredo-1234");

    const [linha] = await banco().select().from(integracoesChaves);
    expect(linha.valorCifrado).toMatch(/^v1\./);
    expect(linha.valorCifrado).not.toContain("segredo");

    const resumo = await resumoDasChaves();
    expect(resumo.anthropic).toEqual({ salva: true, mostra: "••••1234" });
    expect(resumo.venice).toEqual({ salva: false, mostra: null });
  });

  it("a variável antiga entra sozinha uma vez; remover na tela não a traz de volta", async () => {
    process.env.VENICE_API_KEY = "venice-antiga";
    expect(await lerChave("venice")).toBe("venice-antiga");
    expect(await banco().select().from(integracoesChaves)).toHaveLength(1);

    // A variável já pode sair do servidor: a chave continua no hub (lida do banco, não da memória).
    delete process.env.VENICE_API_KEY;
    esquecerChavesLembradas();
    expect(await lerChave("venice")).toBe("venice-antiga");

    // Removida na tela, a variável que sobrou no servidor não volta sozinha.
    process.env.VENICE_API_KEY = "venice-antiga";
    await apagarChave("venice");
    esquecerChavesLembradas();
    expect(await lerChave("venice")).toBeNull();
  });

  it("sem a chave que cifra, não grava, mas a variável antiga continua valendo", async () => {
    delete process.env.HUB_CHAVE_SEGREDOS;
    await expect(gravarChave("anthropic", "sk-ant-x")).rejects.toThrow(/HUB_CHAVE_SEGREDOS/);
    process.env.ANTHROPIC_API_KEY = "sk-ant-da-variavel";
    expect(await lerChave("anthropic")).toBe("sk-ant-da-variavel");
    expect(await banco().select().from(integracoesChaves)).toHaveLength(0);
  });

  it("recusa chave vazia, com espaço no meio ou modelo desconhecido", async () => {
    await expect(gravarChave("venice", "   ")).rejects.toThrow(/Cole a chave/);
    await expect(gravarChave("venice", "abc def")).rejects.toThrow(/não parece uma chave/);
    await expect(gravarChave("modelo-api", "gpt-5")).rejects.toThrow(/Modelo desconhecido/);
    expect(await banco().select().from(integracoesChaves)).toHaveLength(0);
  });
});

describe("integrações: rota das chaves", () => {
  it("só quem tem a chave Integrações salva ou remove", async () => {
    expect((await rotaSalvar(pedido("PUT", { valor: "x" }), ctx("venice"))).status).toBe(401);
    sessao.logado = await usuarioNaOrganizacao((await criarPessoa(["biblioteca"])).id, ORGANIZACAO_PADRAO.id);
    expect((await rotaSalvar(pedido("PUT", { valor: "x" }), ctx("venice"))).status).toBe(403);
    expect((await rotaRemover(pedido("DELETE"), ctx("venice"))).status).toBe(403);
    expect(await lerChave("venice")).toBeNull();
  });

  it("salva conferindo no serviço, devolve só o final e remove", async () => {
    const pessoa = await criarPessoa(["integracoes"]);
    sessao.logado = await usuarioNaOrganizacao(pessoa.id, ORGANIZACAO_PADRAO.id);
    const conferidas: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      conferidas.push(new Headers(init?.headers).get("x-api-key") ?? "");
      return new Response("{}", { status: String(url).includes("api.anthropic.com") && conferidas.at(-1) === "sk-ant-errada" ? 401 : 200 });
    });

    const recusada = await rotaSalvar(pedido("PUT", { valor: "sk-ant-errada" }), ctx("anthropic"));
    expect(recusada.status).toBe(400);
    expect(((await recusada.json()) as { error: string }).error).toMatch(/recusou essa chave/);
    expect(await lerChave("anthropic")).toBeNull();

    const salva = await rotaSalvar(pedido("PUT", { valor: "sk-ant-certa-9876" }), ctx("anthropic"));
    expect(salva.status).toBe(200);
    expect(await salva.json()).toEqual({ salva: true, mostra: "••••9876" });
    expect(conferidas).toEqual(["sk-ant-errada", "sk-ant-certa-9876"]);
    const [linha] = await banco().select().from(integracoesChaves);
    expect(linha.atualizadoPor).toBe(pessoa.id);

    expect((await rotaRemover(pedido("DELETE"), ctx("anthropic"))).status).toBe(200);
    expect(await lerChave("anthropic")).toBeNull();
    expect((await rotaSalvar(pedido("PUT", { valor: "x" }), ctx("inventada"))).status).toBe(400);
  });
});
