import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { usarBanco, type Banco } from "@/db/cliente";
import { bancoDeTeste } from "@/db/teste";
import { salvar } from "@/features/memoria/servicos/memoria";
import { buildSystemPrompt } from "@/lib/server/chat/system";
import { runTool, TOOL_NAMES } from "@/lib/server/chat/tools";

// A Memória no chat interno: prompt de sistema (com e sem banco) e as ferramentas memoria_buscar / memoria_ler.
const urlOriginal = process.env.DATABASE_URL;
const ana = { id: null, nome: "Ana" };
const ctx = { signal: new AbortController().signal };

describe("memória no chat interno", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "postgres://banco-de-teste";
    await bancoDeTeste();
  });
  afterAll(() => {
    if (urlOriginal === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = urlOriginal;
  });

  it("com banco, o prompt traz a memória no lugar dos playbooks", async () => {
    await salvar({ slug: "02-regras", conteudo: "# Regras gerais\n\nNunca invente dado.", versaoEsperada: null, tipo: "regra", noPrompt: true }, ana);
    await salvar({ slug: "05-traducao", conteudo: "# Tradução de criativos\n\nPasso a passo.", versaoEsperada: null, tipo: "fluxo", frente: "cod" }, ana);
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("descritas na memória da operação abaixo");
    expect(prompt).toContain("# Memória da operação");
    expect(prompt).toContain('<documento slug="02-regras" titulo="Regras gerais" tipo="regra" versao="1">\n# Regras gerais\n\nNunca invente dado.\n</documento>');
    expect(prompt).toContain("- 05-traducao · Tradução de criativos · Fluxos · COD");
    expect(prompt).toContain("memoria_buscar");
    expect(prompt).not.toContain("# Playbooks");
    expect(prompt).not.toContain("Passo a passo.");
  });

  it("sem banco, banco vazio ou banco com erro: playbooks do disco", async () => {
    expect(await buildSystemPrompt()).toContain("# Playbooks"); // banco vazio

    delete process.env.DATABASE_URL;
    expect(await buildSystemPrompt()).toContain("descritas nos playbooks abaixo");

    process.env.DATABASE_URL = "postgres://banco-de-teste";
    usarBanco({
      select: () => {
        throw new Error("banco fora do ar");
      },
    } as unknown as Banco);
    const erroOriginal = console.error;
    console.error = () => {};
    try {
      expect(await buildSystemPrompt()).toContain("# Playbooks");
    } finally {
      console.error = erroOriginal;
    }
  });

  it("memoria_buscar e memoria_ler respondem para o agente", async () => {
    expect(TOOL_NAMES.slice(-2)).toEqual(["memoria_buscar", "memoria_ler"]);
    await salvar({ slug: "05-traducao", conteudo: "# Tradução de criativos\n\nComo traduzir um AD.", versaoEsperada: null, tipo: "fluxo" }, ana);
    await salvar({ slug: "longo", conteudo: `# Longo\n\n${"x".repeat(45_000)}`, versaoEsperada: null, tipo: "fato" }, ana);

    const busca = await runTool("memoria_buscar", { consulta: "traducao" }, ctx);
    expect(busca).toMatchObject({ error: false, summary: "1 documento" });
    expect(String(busca.content)).toContain('"slug": "05-traducao"');
    expect(String(busca.content)).toContain("Tradução de criativos");

    expect((await runTool("memoria_buscar", { tipo: "fato" }, ctx)).summary).toBe("1 documento");

    const lido = await runTool("memoria_ler", { slug: "05-traducao" }, ctx);
    expect(lido).toMatchObject({ error: false, summary: "leu 05-traducao" });
    expect(String(lido.content)).toMatch(/^Tradução de criativos \(05-traducao\) · Fluxos · Geral\nVersão 1, de Ana/);

    const longo = await runTool("memoria_ler", { slug: "longo" }, ctx);
    expect(String(longo.content)).toContain("[Cortado:");
    expect(String(longo.content).length).toBeLessThan(41_000);

    expect(await runTool("memoria_ler", { slug: "nao-existe" }, ctx)).toMatchObject({ error: true });
    // Nome de arquivo dos links antigos também serve.
    await salvar({ slug: "projeto-dewalt-ads-cl", conteudo: "# DeWalt\n\nx", versaoEsperada: null, tipo: "projeto" }, ana);
    expect(await runTool("memoria_ler", { slug: "projetos/dewalt-ads-cl.md" }, ctx)).toMatchObject({ error: false, summary: "leu projeto-dewalt-ads-cl" });
    expect(String((await runTool("memoria_ler", { slug: "05-traducao", versao: 4 }, ctx)).content)).toContain("não tem a versão 4");
  });
});
