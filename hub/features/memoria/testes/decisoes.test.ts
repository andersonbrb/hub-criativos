import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { AVISO_DO_CONTEXTO_ANTIGO, aplicarDecisoesDoSavio, aplicarDecisoesEmTodasAsOrganizacoes } from "@/features/memoria/servicos/decisoes-do-savio";
import { documentosDoPrompt, historico, ler, pendentesDeRevisao, salvar } from "@/features/memoria/servicos/memoria";
import { normalizarConteudo } from "@/features/memoria/texto";
import { buildSystemPrompt } from "@/lib/server/chat/system";

// Decisão de 20/10/2026 (como fazer vídeo segue só o contexto do Sávio) aplicada na Memória como estava na produção:
// os documentos importados do hub com o texto antigo (guardado em playbooks/historico/2026-10-20).
const urlOriginal = process.env.DATABASE_URL;
const naPadrao = <T,>(fn: () => Promise<T>) => comOrganizacao(ORGANIZACAO_PADRAO.id, fn);
const HIST = path.join(process.cwd(), "playbooks", "historico", "2026-10-20");
const antigo = (nome: string) => normalizarConteudo(readFileSync(path.join(HIST, nome), "utf8"));
const novo = (arquivo: string) => normalizarConteudo(readFileSync(path.join(process.cwd(), arquivo), "utf8"));
const hub = { id: null, nome: "Hub (playbooks)" };

async function estadoDaProducao() {
  await salvar(
    {
      slug: "decisoes-pendentes",
      conteudo: antigo("decisoes-pendentes.md"),
      versaoEsperada: null,
      tipo: "decisao",
      noPrompt: false,
      precisaRevisao: true,
      metadados: { origem: "features/memoria/importacao/decisoes-pendentes.md", motivoRevisao: "18 conflitos entre as regras do Sávio e as do Hub aguardam decisão." },
    },
    { id: null, nome: "Hub (importação)" },
  );
  for (const [slug, arquivo, frente] of [
    ["playbook-dropshipping-cod-criativos", "dropshipping-cod-criativos.md", "cod"],
    ["playbook-infoproduto-edicao-video", "infoproduto-edicao-video.md", "info"],
    ["playbook-variacoes-criativo-validado", "variacoes-criativo-validado.md", "geral"],
  ] as const)
    await salvar({ slug, conteudo: antigo(arquivo), versaoEsperada: null, tipo: "playbook", frente, noPrompt: true }, hub);
  await salvar(
    {
      slug: "playbook-contexto-grupo-chegou",
      conteudo: antigo("contexto-grupo-chegou.md"),
      versaoEsperada: null,
      tipo: "fato",
      noPrompt: false,
      precisaRevisao: true,
      metadados: { motivoRevisao: "retrato de 06/10, substituído pelos arquivos 01–03 e projetos do Sávio" },
    },
    hub,
  );
  await salvar({ slug: "03-preferencias-de-trabalho", conteudo: "# Preferências\n\nSó pedir confirmação para gasto real.", versaoEsperada: null, tipo: "regra", noPrompt: true }, { id: null, nome: "Sávio (contexto-savio)" });
}

describe("decisões do Sávio na Memória", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "postgres://banco-de-teste";
    await bancoDeTeste();
  });
  afterAll(() => {
    if (urlOriginal === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = urlOriginal;
  });

  it("fecha as decisões, troca os playbooks e guarda as versões antigas no histórico", () => naPadrao(async () => {
    await estadoDaProducao();
    const r = await aplicarDecisoesDoSavio();
    expect(r.recusados).toEqual([]);
    expect(r.atualizados.sort()).toEqual([
      "decisoes-pendentes",
      "playbook-contexto-grupo-chegou",
      "playbook-dropshipping-cod-criativos",
      "playbook-infoproduto-edicao-video",
      "playbook-variacoes-criativo-validado",
    ]);

    const decisoes = (await ler("decisoes-pendentes"))!;
    expect(decisoes.conteudo).toBe(novo("features/memoria/importacao/decisoes-pendentes.md"));
    expect(decisoes).toMatchObject({ titulo: "Decisões: regras do Sávio x regras antigas do Hub (fechado em 20/10/2026)", noPrompt: true, precisaRevisao: false });
    expect(decisoes.metadados.motivoRevisao).toBeUndefined();
    expect(decisoes.conteudo).not.toContain("(pendente)");
    // Versão antiga guardada: dá para ler a v1 com o texto de antes.
    expect((await historico("decisoes-pendentes")).map((v) => v.versao)).toEqual([2, 1]);
    expect((await ler("decisoes-pendentes", 1))!.conteudo).toContain("**Decisão:** (pendente)");

    const cod = (await ler("playbook-dropshipping-cod-criativos"))!;
    expect(cod.conteudo).toBe(novo("playbooks/dropshipping-cod-criativos.md"));
    for (const saiu of ["no children", "Sem crianças", "CapCut", "Savin", "20 a 25", "desde o primeiro frame", "Solo demostración", "Produtividade com ia"])
      expect(cod.conteudo, saiu).not.toContain(saiu);
    expect(cod.conteudo).toContain("Solo con fines demostrativos. Algunas escenas están aceleradas.");

    const info = (await ler("playbook-infoproduto-edicao-video"))!;
    expect(info.titulo).toBe("Agente de Edição de Vídeo — infoproduto");
    for (const saiu of ["Darlan", "Savin", "Montserrat", "sandbox_exec", "SPACING"]) expect(info.conteudo, saiu).not.toContain(saiu);

    const contexto = (await ler("playbook-contexto-grupo-chegou"))!;
    expect(contexto.conteudo.startsWith(AVISO_DO_CONTEXTO_ANTIGO)).toBe(true);
    expect(contexto.conteudo).toContain(antigo("contexto-grupo-chegou.md").trim());
    expect(contexto).toMatchObject({ titulo: "Contexto Grupo Chegou de 06/10/2026 (substituído)", noPrompt: false, precisaRevisao: false });

    // Entra no prompt dos agentes: as regras do Sávio e as decisões fechadas.
    expect((await documentosDoPrompt()).map((d) => d.slug)).toContain("decisoes-pendentes");
    expect((await pendentesDeRevisao()).map((d) => d.slug)).toEqual([]);

    // De novo: nada muda, nenhuma versão nova.
    const r2 = await aplicarDecisoesDoSavio();
    expect(r2.atualizados).toEqual([]);
    expect((await historico("playbook-dropshipping-cod-criativos")).length).toBe(2);
  }));

  it("documento editado na tela não é trocado: vai para a revisão uma vez só", () => naPadrao(async () => {
    await estadoDaProducao();
    const v1 = (await ler("playbook-variacoes-criativo-validado"))!;
    await salvar({ slug: v1.slug, conteudo: `${v1.conteudo}\nNota da Ana.`, versaoEsperada: v1.versao }, { id: null, nome: "Ana" });

    const r = await aplicarDecisoesDoSavio();
    expect(r.editadosNaTela).toEqual(["playbook-variacoes-criativo-validado"]);
    const depois = (await ler("playbook-variacoes-criativo-validado"))!;
    expect(depois.conteudo).toContain("Nota da Ana.");
    expect(depois.precisaRevisao).toBe(true);
    expect(String(depois.metadados.motivoRevisao)).toMatch(/editado na tela/);
    expect(depois.versao).toBe(2);

    // Revisado pela pessoa, o aviso não volta no próximo reinício.
    await salvar({ slug: depois.slug, conteudo: depois.conteudo, versaoEsperada: depois.versao, precisaRevisao: false }, { id: null, nome: "Ana" });
    await aplicarDecisoesDoSavio();
    expect((await ler("playbook-variacoes-criativo-validado"))!.precisaRevisao).toBe(false);
  }));

  it("roda em todas as organizações que têm os documentos, ao subir o servidor", async () => {
    await naPadrao(estadoDaProducao);
    const log = console.log;
    console.log = () => {};
    try {
      await aplicarDecisoesEmTodasAsOrganizacoes();
    } finally {
      console.log = log;
    }
    expect((await naPadrao(() => ler("decisoes-pendentes")))!.noPrompt).toBe(true);
  });

  it("o prompt dos agentes manda seguir só o Sávio em como fazer vídeo", () => naPadrao(async () => {
    await estadoDaProducao();
    await aplicarDecisoesDoSavio();
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("COMO FAZER VÍDEO: a referência é só o contexto do Sávio");
    expect(prompt).toContain('<documento slug="decisoes-pendentes"');
    // As regras antigas saíram do texto do hub (o documento das decisões ainda as cita como "Saiu").
    const doHub = prompt.split("# Memória da operação")[0];
    for (const saiu of ["siga as do hub até a decisão", "eleven_v4", "efeito sonoro", "Scribe por padrão", "mais de 4 vídeos", "grade 6s/7s", "sem frame"])
      expect(doHub + prompt.split("# Memória da operação")[1].replace(/<documento slug="decisoes-pendentes"[\s\S]*?<\/documento>/, ""), saiu).not.toContain(saiu);

    // PC sem banco: o documento das decisões vai junto dos playbooks do disco.
    delete process.env.DATABASE_URL;
    const doDisco = await buildSystemPrompt();
    expect(doDisco).toContain('<documento arquivo="decisoes-pendentes.md">');
    expect(doDisco).not.toContain('arquivo="contexto-grupo-chegou.md"');
  }));
});
