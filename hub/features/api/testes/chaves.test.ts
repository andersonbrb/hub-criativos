import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as revogarRota } from "@/app/api/chaves-de-api/[id]/route";
import { GET as listarRota, POST as criarRota } from "@/app/api/chaves-de-api/route";
import { GET as conferirRota } from "@/app/api/chave-de-api/route";
import { POST as gerarGanchos } from "@/app/api/skala/criativos/route";
import { banco } from "@/db/cliente";
import { chavesApi, skalaEntregas } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, type Chave, type Papel } from "@/features/acesso/contrato";
import { criarConta, criarOrganizacao } from "@/features/acesso/testes/ajuda";
import type { ChaveNaTela } from "@/features/api/contrato";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import { VARIAVEL_DA_CHAVE } from "@/features/skala/contrato";

// Chaves de API (features/api): o admin cria na tela, outro sistema usa no "Gerar ganchos" do mesmo jeito que a chave
// fixa do Skala, revogar corta na hora, e a chave fixa continua valendo.

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});

const BASE = "https://hub.teste";
const CHAVE_FIXA = "chave-fixa-do-skala-com-mais-de-32-letras-123";
const original = { url: process.env.DATABASE_URL, chave: process.env[VARIAVEL_DA_CHAVE] };
const CORPO = { criativos: [{ id: "7430000000000000001", nome: "CAMERA - AD03", video_url: "https://v16m.tiktokcdn.com/v.mp4", metricas: { Vendas: 87 } }] };
// Pedidos da tela vêm do próprio hub (a trava contra outro site olha este cabeçalho).
const DA_TELA = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

async function entrar(papel: Papel, chaves: Chave[] = ["integracoes"], organizacaoId?: string) {
  const pessoa = await criarConta({ email: `${papel}-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, papel, chaves, senha: null, ...(organizacaoId ? { organizacaoId } : {}) });
  sessao.logado = pessoa.id;
  sessao.organizacao = organizacaoId ?? ORGANIZACAO_PADRAO.id;
  return pessoa;
}

const criar = (nome: string) => criarRota(new Request(`${BASE}/api/chaves-de-api`, { method: "POST", headers: DA_TELA, body: JSON.stringify({ nome }) }));
const listar = () => listarRota();
const revogar = (id: string) =>
  revogarRota(new Request(`${BASE}/api/chaves-de-api/${id}`, { method: "DELETE", headers: DA_TELA }), { params: Promise.resolve({ id }) });
const comChave = (chave: string | null): Record<string, string> => (chave ? { authorization: `Bearer ${chave}` } : {});
const ganchos = (chave: string | null) =>
  gerarGanchos(new Request(`${BASE}/api/skala/criativos`, { method: "POST", headers: { "content-type": "application/json", ...comChave(chave) }, body: JSON.stringify(CORPO) }));
const conferir = (chave: string | null) => conferirRota(new Request(`${BASE}/api/chave-de-api`, { headers: comChave(chave) }));

describe("chaves de API", () => {
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.DATABASE_URL = "postgres://banco-de-teste";
    process.env[VARIAVEL_DA_CHAVE] = CHAVE_FIXA;
    await bancoDeTeste();
    sessao.logado = null;
    sessao.organizacao = ORGANIZACAO_PADRAO.id;
  });
  afterAll(() => {
    for (const [nome, valor] of [["DATABASE_URL", original.url], [VARIAVEL_DA_CHAVE, original.chave]] as const) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });

  it("o admin cria a chave: ela aparece inteira uma vez, e o banco e a lista guardam só o começo", async () => {
    await entrar("admin");
    const res = await criar("Skala — produção");
    expect(res.status).toBe(201);
    const { chave, registro } = (await res.json()) as { chave: string; registro: ChaveNaTela };
    expect(chave).toMatch(/^hub_api_[\w-]{40,}$/);
    expect(registro).toMatchObject({ nome: "Skala — produção", comeco: chave.slice(0, 12), ultimoUsoEm: null, revogadaEm: null });

    const [linha] = await banco().select().from(chavesApi);
    expect(JSON.stringify(linha)).not.toContain(chave);
    const lista = (await (await listar()).json()) as { chaves: ChaveNaTela[] };
    expect(lista.chaves).toHaveLength(1);
    expect(JSON.stringify(lista)).not.toContain(chave);
  });

  it("só dono e admin criam, listam e revogam; nome é obrigatório", async () => {
    await entrar("dono");
    const { registro } = (await (await criar("Funila")).json()) as { registro: ChaveNaTela };
    expect((await criar("x")).status).toBe(400);

    await entrar("membro", ["integracoes", "chat"]);
    expect((await criar("Outra")).status).toBe(403);
    expect((await listar()).status).toBe(403);
    expect((await revogar(registro.id)).status).toBe(403);
    expect(await banco().select().from(chavesApi)).toHaveLength(1);
  });

  it("a chave nova vale no Gerar ganchos do mesmo jeito que a fixa; revogada, deixa de valer na hora", async () => {
    await entrar("admin");
    const { chave, registro } = (await (await criar("Skala — produção")).json()) as { chave: string; registro: ChaveNaTela };

    const usada = await ganchos(chave);
    expect(usada.status).toBe(201);
    expect(((await usada.json()) as { url: string }).url).toMatch(/^https:\/\/hub\.teste\/chat\?skala=hub_sk_/);
    const [entrega] = await banco().select().from(skalaEntregas);
    expect(entrega).toMatchObject({ organizacaoId: ORGANIZACAO_PADRAO.id, chaveApiId: registro.id });
    const [depoisDoUso] = (await (await listar()).json()).chaves as ChaveNaTela[];
    expect(depoisDoUso.ultimoUsoEm).not.toBeNull();

    expect((await revogar(registro.id)).status).toBe(200);
    const recusada = await ganchos(chave);
    expect(recusada.status).toBe(401);
    expect(((await recusada.json()) as { error: string }).error).toBe("Chave de API inválida ou revogada.");
    expect((await conferir(chave)).status).toBe(401);
    expect((await revogar(registro.id)).status).toBe(404);
    const [naLista] = (await (await listar()).json()).chaves as ChaveNaTela[];
    expect(naLista.revogadaEm).not.toBeNull();
    expect(await banco().select().from(skalaEntregas)).toHaveLength(1);
  });

  it("a chave fixa do Skala continua valendo (Grupo Chegou), mesmo com chaves novas; sem a variável, só as novas", async () => {
    await entrar("admin");
    const { chave } = (await (await criar("Skala")).json()) as { chave: string };
    expect((await ganchos(CHAVE_FIXA)).status).toBe(201);
    const fixa = (await banco().select().from(skalaEntregas))[0];
    expect(fixa).toMatchObject({ organizacaoId: ORGANIZACAO_PADRAO.id, chaveApiId: null });
    expect(await (await conferir(CHAVE_FIXA)).json()).toEqual({ ok: true, organizacao: "Grupo Chegou", chave: "Chave fixa do Skala" });

    delete process.env[VARIAVEL_DA_CHAVE];
    expect((await ganchos(CHAVE_FIXA)).status).toBe(401);
    expect((await ganchos(chave)).status).toBe(201);
    expect((await ganchos(null)).status).toBe(401);
  });

  it("chave de outra organização manda para a organização dela, e o admin de uma não revoga a da outra", async () => {
    const outra = await criarOrganizacao("Cliente X");
    await entrar("admin", ["integracoes"], outra);
    const { chave, registro } = (await (await criar("Funila do cliente")).json()) as { chave: string; registro: ChaveNaTela };
    expect(await (await conferir(chave)).json()).toEqual({ ok: true, organizacao: "Cliente X", chave: "Funila do cliente" });
    expect((await ganchos(chave)).status).toBe(201);
    const [entrega] = await banco().select().from(skalaEntregas);
    expect(entrega.organizacaoId).toBe(outra);

    await entrar("admin");
    expect((await revogar(registro.id)).status).toBe(404);
    expect((await (await listar()).json()).chaves).toHaveLength(0);
    expect((await conferir(chave)).status).toBe(200);
  });
});
