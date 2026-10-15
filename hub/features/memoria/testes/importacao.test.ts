import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { bancoDeTeste } from "@/db/teste";
import { importarMemoria, lerIndiceDeProjetos, primeiraData } from "@/features/memoria/importacao/importar";
import { slugDoArquivo, trocarLinksMd } from "@/features/memoria/texto";
import { buscar, documentosDoPrompt, historico, indiceDeProjetos, ler, listarIndice, pendentesDeRevisao, salvar } from "@/features/memoria/servicos/memoria";

// Roda contra a pasta real do contexto do Sávio, só nesta máquina (o conteúdo não entra no git).
const PASTA_SAVIO = "C:\\Users\\Vinic\\OneDrive\\Documentos\\Programação\\contexto-savio";
const temPasta = existsSync(path.join(PASTA_SAVIO, "contexto"));

const mds = (pasta: string) => (existsSync(pasta) ? readdirSync(pasta).filter((n) => n.endsWith(".md")) : []);

describe("importação: partes puras", () => {
  it("lê a data e a tabela do índice de projetos", () => {
    expect(primeiraData("03–05/10/2026")).toBe("2026-10-03");
    expect(primeiraData("04/10 e 08/10/2026")).toBe("2026-10-04");
    expect(primeiraData("sem data")).toBeNull();
    const mapa = lerIndiceDeProjetos(
      "| Projeto | Frente | Mercado | Data | Status | Arquivo |\n|---|---|---|---|---|---|\n| X | COD (+ e-com IT) | CL | 09–10/10/2026 | Entregue | [x.md](x.md) |\n| Y | e-com | UK | 08/10/2026 | Pronto | [y.md](y.md) |",
    );
    expect(mapa.get("x")).toMatchObject({ frente: "cod", mercado: "CL", data: "2026-10-09", status: "Entregue", frenteOriginal: "COD (+ e-com IT)" });
    expect(mapa.get("y")?.frente).toBe("geral");
  });
});

describe.skipIf(!temPasta)("importação do contexto do Sávio (pasta real)", () => {
  beforeAll(async () => {
    await bancoDeTeste();
  });

  it("o índice de busca existe", async () => {
    const r = (await banco().execute(sql`select indexdef from pg_indexes where indexname = 'memoria_documentos_busca_idx'`)) as unknown as {
      rows: { indexdef: string }[];
    };
    expect(r.rows[0]?.indexdef).toMatch(/USING gin \(to_tsvector\('simple'::regconfig, busca\)\)/);
  });

  it("importa tudo, é idempotente e não desfaz edição feita no hub", async () => {
    const contexto = path.join(PASTA_SAVIO, "contexto");
    const arquivosSavio = 1 + mds(contexto).length + mds(path.join(contexto, "projetos")).length;
    const playbooks = mds(path.join(process.cwd(), "playbooks")).filter((n) => n.toLowerCase() !== "readme.md").length;
    expect(arquivosSavio).toBe(43);
    const esperado = arquivosSavio + playbooks + 1; // + decisoes-pendentes

    const primeira = await importarMemoria({ pastaSavio: PASTA_SAVIO });
    expect(primeira.recusados).toEqual([]);
    expect(primeira.criados).toHaveLength(esperado);
    expect(primeira.commit).not.toBe("");

    const indice = await listarIndice();
    expect(indice).toHaveLength(esperado);
    const porSlug = new Map(indice.map((d) => [d.slug, d]));
    for (const slug of ["leia-primeiro", "modelo-de-documento", "projetos-indice-original", "22-licoes-producao-video", "decisoes-pendentes"])
      expect(porSlug.has(slug), slug).toBe(true);
    expect(indice.filter((d) => d.tipo === "projeto")).toHaveLength(18);
    expect(indice.filter((d) => d.tipo === "playbook").map((d) => d.slug).sort()).toEqual([
      "playbook-dropshipping-cod-criativos",
      "playbook-infoproduto-edicao-video",
      "playbook-variacoes-criativo-validado",
    ]);
    expect(porSlug.get("playbook-infoproduto-edicao-video")?.frente).toBe("info");
    expect(porSlug.get("playbook-dropshipping-cod-criativos")).toMatchObject({ frente: "cod", titulo: "Produtor de criativos COD (dropshipping)" });
    expect(porSlug.get("playbook-contexto-grupo-chegou")).toMatchObject({ tipo: "fato", noPrompt: false, precisaRevisao: true });
    expect(porSlug.get("14-unit-economics-cod")).toMatchObject({ tipo: "fato", frente: "cod" });
    expect(porSlug.get("21-github-e-repositorio")?.metadados.motivoRevisao).toMatch(/deixou de existir/);
    expect(porSlug.get("decisoes-pendentes")).toMatchObject({ tipo: "decisao", titulo: "Decisões pendentes: regras do Sávio x regras atuais do Hub" });

    const fila = (await pendentesDeRevisao()).map((d) => d.slug);
    expect(fila).toEqual(expect.arrayContaining(["21-github-e-repositorio", "playbook-contexto-grupo-chegou", "decisoes-pendentes"]));
    console.log(`[importação] ${indice.length} documentos (${arquivosSavio} do Sávio, ${playbooks} playbooks, 1 de decisões); fila de revisão: ${fila.length} (${fila.join(", ")})`);

    expect((await documentosDoPrompt()).map((d) => d.slug)).toEqual([
      "02-regras-gerais-e-seguranca",
      "03-preferencias-de-trabalho",
      "leia-primeiro",
      "01-perfil-e-operacao",
      "playbook-dropshipping-cod-criativos",
      "playbook-infoproduto-edicao-video",
      "playbook-variacoes-criativo-validado",
    ]);

    const projetos = await indiceDeProjetos();
    expect(projetos).toHaveLength(18);
    expect(projetos.every((p) => p.status && p.data && !p.precisaRevisao)).toBe(true);
    expect(projetos.find((p) => p.slug === "projeto-dewalt-ads-cl")).toMatchObject({ frente: "cod", mercado: "Chile", data: "2026-10-09" });

    // Os links entre arquivos do repositório antigo apontam para documentos que existem.
    const existe = (slug: string) => porSlug.has(slug);
    const quebrados: string[] = [];
    for (const d of indice) {
      const conteudo = (await ler(d.slug))!.conteudo;
      for (const [, href] of conteudo.matchAll(/\]\(([^)\s]+\.md)(?:#[^)\s]*)?\)/g))
        if (!/^[a-z]+:/i.test(href) && !slugDoArquivo(href, existe)) quebrados.push(`${d.slug} → ${href}`);
      // Depois da troca, nenhum link relativo para .md sobra no texto exibido.
      expect(trocarLinksMd(conteudo, existe)).not.toMatch(/\]\((?![a-z]+:)[^)\s]+\.md\)/);
    }
    expect(quebrados).toEqual([]);

    const doc = await ler("05-traducao-de-criativos");
    expect(doc?.autor).toMatch(/^Sávio \(contexto-savio, commit [0-9a-f]{7,}\)$/);
    expect((await buscar("traducao")).length).toBeGreaterThan(0);

    // Segunda vez: nada muda.
    const segunda = await importarMemoria({ pastaSavio: PASTA_SAVIO });
    expect(segunda).toMatchObject({ criados: [], atualizados: [], recusados: [] });
    expect(segunda.iguais).toHaveLength(esperado);
    expect(await listarIndice()).toHaveLength(esperado);
    expect(await historico("05-traducao-de-criativos")).toHaveLength(1);

    // Edição feita no hub depois da importação: rodar de novo não volta o texto antigo.
    await salvar({ slug: "05-traducao-de-criativos", conteudo: `${doc!.conteudo}\nNota do hub.\n`, versaoEsperada: 1 }, { id: null, nome: "Ana" });
    const terceira = await importarMemoria({ pastaSavio: PASTA_SAVIO });
    expect(terceira.atualizados).toEqual([]);
    expect((await ler("05-traducao-de-criativos"))?.conteudo).toContain("Nota do hub.");
  });
});
