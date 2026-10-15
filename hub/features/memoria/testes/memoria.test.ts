import { beforeEach, describe, expect, it } from "vitest";

import { bancoDeTeste } from "@/db/teste";
import { ConflitoDeVersao, DocNaoEncontrado, SegredoDetectado } from "@/features/memoria/erros";
import {
  acrescentarSecao,
  buscar,
  documentosDoPrompt,
  historico,
  indiceDeProjetos,
  inserirLicao,
  ler,
  listarIndice,
  marcarRevisado,
  pendentesDeRevisao,
  registrarLicao,
  registrarProjeto,
  restaurar,
  salvar,
  SLUG_LICOES,
} from "@/features/memoria/servicos/memoria";
import { acharSegredo } from "@/features/memoria/servicos/segredos";
import { trocarLinksMd, trechoEmVolta } from "@/features/memoria/texto";

const ana = { id: null, nome: "Ana" };
const bia = { id: null, nome: "Bia" };

const novo = (slug: string, conteudo: string, extra: Record<string, unknown> = {}) =>
  salvar({ slug, conteudo, versaoEsperada: null, tipo: "fluxo", frente: "geral", ...extra }, ana);

describe("memória: gravar, ler e versões", () => {
  beforeEach(async () => {
    await bancoDeTeste();
  });

  it("cria, lê e salva com versão", async () => {
    const criado = await novo("05-traducao", "# Tradução de criativos\n\nTexto inicial.");
    expect(criado).toMatchObject({ slug: "05-traducao", titulo: "Tradução de criativos", versao: 1, autor: "Ana", tipo: "fluxo" });

    const salvo = await salvar({ slug: "05-traducao", conteudo: "# Tradução de criativos\n\nTexto novo.", versaoEsperada: 1, nota: "ajuste" }, bia);
    expect(salvo.versao).toBe(2);
    expect(salvo.autor).toBe("Bia");

    expect((await ler("05-traducao"))?.conteudo).toContain("Texto novo.");
    expect((await ler("05-traducao", 1))?.conteudo).toContain("Texto inicial.");
    expect((await ler("05-traducao", 1))?.autor).toBe("Ana");
    expect(await ler("05-traducao", 9)).toBeNull();
    expect(await ler("nao-existe")).toBeNull();

    const h = await historico("05-traducao");
    expect(h.map((v) => v.versao)).toEqual([2, 1]);
    expect(h[0]).toMatchObject({ autor: "Bia", nota: "ajuste" });
    expect(h[0].sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("conteúdo igual não cria versão; versão errada dá conflito", async () => {
    await novo("doc", "Texto.");
    // Só muda a quebra de linha do fim (a caixa de texto da tela perde): continua igual.
    const igual = await salvar({ slug: "doc", conteudo: "Texto.\r\n\r\n", versaoEsperada: 1 }, bia);
    expect(igual.versao).toBe(1);
    expect(igual.autor).toBe("Ana");
    expect(await historico("doc")).toHaveLength(1);

    await expect(salvar({ slug: "doc", conteudo: "Outro.", versaoEsperada: 3 }, bia)).rejects.toBeInstanceOf(ConflitoDeVersao);
    await expect(salvar({ slug: "sumiu", conteudo: "x", versaoEsperada: 1 }, bia)).rejects.toBeInstanceOf(DocNaoEncontrado);
  });

  it("duas gravações sobre a mesma versão: só uma passa", async () => {
    await novo("doc", "Versão 1.");
    const resultados = await Promise.allSettled([
      salvar({ slug: "doc", conteudo: "Edição da Ana.", versaoEsperada: 1 }, ana),
      salvar({ slug: "doc", conteudo: "Edição da Bia.", versaoEsperada: 1 }, bia),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0].reason).toBeInstanceOf(ConflitoDeVersao);
    expect((falhas[0].reason as ConflitoDeVersao).versaoAtual).toBe(2);
    expect(await historico("doc")).toHaveLength(2);
  });

  it("criar com slug que já existe dá conflito", async () => {
    await novo("doc", "Primeiro.");
    await expect(novo("doc", "Segundo.")).rejects.toBeInstanceOf(ConflitoDeVersao);
    const duas = await Promise.allSettled([novo("outro", "A."), novo("outro", "B.")]);
    expect(duas.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("recusa slug inválido, reservado e documento novo sem tipo", async () => {
    await expect(novo("Com Espaço", "x")).rejects.toThrow(/slug/i);
    await expect(novo("busca", "x")).rejects.toThrow(/reservado/);
    await expect(salvar({ slug: "sem-tipo", conteudo: "x", versaoEsperada: null }, ana)).rejects.toThrow(/tipo/);
  });

  it("acrescentar seção e restaurar criam versões novas", async () => {
    await novo("doc", "# Doc\n\nOriginal.");
    const comSecao = await acrescentarSecao("doc", { titulo: "Novidade", conteudo: "Algo novo." }, bia);
    expect(comSecao.versao).toBe(2);
    expect(comSecao.conteudo).toMatch(/Original\.\n\n## Novidade \(\d{4}-\d{2}-\d{2}\)\n\nAlgo novo\.\n$/);

    const restaurado = await restaurar("doc", 1, ana);
    expect(restaurado.versao).toBe(3);
    expect(restaurado.conteudo).toBe("# Doc\n\nOriginal.\n");
    expect((await historico("doc"))[0].nota).toBe("restaurado da versão 1");
    await expect(restaurar("doc", 7, ana)).rejects.toThrow(/não existe/);
  });

  it("fila de revisão, prompt e índice", async () => {
    await novo("02-regras", "# Regras\n\nx", { tipo: "regra", noPrompt: true });
    await novo("21-github", "# GitHub\n\nx", { tipo: "regra", precisaRevisao: true, metadados: { motivoRevisao: "mudou" } });
    await novo("05-traducao", "# Tradução\n\nx", { frente: "cod" });

    expect((await pendentesDeRevisao()).map((d) => d.slug)).toEqual(["21-github"]);
    const revisado = await marcarRevisado("21-github", bia);
    expect(revisado.precisaRevisao).toBe(false);
    expect(revisado.metadados).toMatchObject({ revisado: { por: "Bia", motivo: "mudou" } });
    expect(await pendentesDeRevisao()).toEqual([]);

    expect((await documentosDoPrompt()).map((d) => d.slug)).toEqual(["02-regras"]);
    // Ordem: tipo (regra antes de fluxo), depois slug.
    expect((await listarIndice()).map((d) => d.slug)).toEqual(["02-regras", "21-github", "05-traducao"]);
    expect((await listarIndice({ frente: "cod" })).map((d) => d.slug)).toEqual(["05-traducao"]);
    expect((await listarIndice({ tipo: "regra", frente: "geral" })).map((d) => d.slug)).toEqual(["02-regras", "21-github"]);
  });
});

describe("memória: barreira de segredo", () => {
  beforeEach(async () => {
    await bancoDeTeste();
  });

  it("barra chaves, tokens e senhas", async () => {
    const segredos = [
      "chave sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      "OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      "ak_1a2b3c4d5e6f7g8h9i0j",
      "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
      "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
      "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
      "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
      "AKIAIOSFODNN7EXAMPLE",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "Authorization: Bearer abcdefghijklmnop1234567890",
      "api_key: 9f8e7d6c5b4a39281706",
      "SENHA = MinhaSenhaForte2026!",
      "password=SuperSecretPassword",
      "access_token=EAABwzLixnjYBO1234567890abcdefghijklmn",
      "xi-api-key: 1234567890abcdef1234567890abcdef",
      "CPF 123.456.789-09",
    ];
    for (const s of segredos) expect(acharSegredo(s), s).not.toBeNull();
    await expect(novo("doc", `Config:\n${segredos[0]}`)).rejects.toBeInstanceOf(SegredoDetectado);
    await expect(novo("doc", "ok", { metadados: { obs: segredos[12] } })).rejects.toBeInstanceOf(SegredoDetectado);
    expect(await ler("doc")).toBeNull();
  });

  it("não barra IDs, URLs e o texto que ensina a varredura", async () => {
    const normais = [
      "Conta de anúncio act_1234567890123456 (BM 987654321098765)",
      "ID da conta: 1234567890123456",
      "voice_id: EXAVITQu4vr4xnSDxMaL · voz pNInz6obpgDQGcFmaJgB",
      "Avatar Abigail_expressive_2024112501, look 3f2a1b4c5d6e7f8091a2b3c4d5e6f708",
      "Projeto Flora 0c8a7b1e-3f2d-4c5b-9a8e-7d6c5b4a3f21",
      "Página https://chileverificada.com/products/kit-hombre-3-en-1?variant=45123456789012&utm_source=meta",
      "https://app.flora.ai/projects/abc123def456ghi789",
      "Lote sk-reel-medalla-es-vencedores e task-force-2026",
      "Senha: guardada no cofre, nunca no texto",
      "token: precisa-de-revisao-manual",
      "Tokens gastos: 123456789012345",
      // A linha de varredura do arquivo 21 do Sávio (cita as palavras, sem valor).
      'git diff --cached -U0 | grep -nEi "(sk-[A-Za-z0-9]{20,}|xi-api-key|api[_-]?key\\s*[:=]|secret\\s*[:=]|token\\s*[:=]|password|senha\\s*[:=]|Bearer [A-Za-z0-9]|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|EAA[A-Za-z0-9]{20,})"',
      "Nunca subir .env, settings.local.json, chaves de API, tokens, senhas, cookies.",
      "Use o header Bearer com o token do .env",
    ];
    for (const s of normais) expect(acharSegredo(s), s).toBeNull();
    await expect(novo("ids", normais.join("\n"))).resolves.toMatchObject({ versao: 1 });
  });
});

describe("memória: busca", () => {
  beforeEach(async () => {
    await bancoDeTeste();
    await novo("05-traducao-de-criativos", "# Tradução de criativos (outro idioma)\n\nComo levar um AD para o espanhol do Chile. Lipsync por trecho.");
    await novo("08-voz", "# Voz e dublagem\n\nA traducao da fala vai antes da voz clonada. Música a −14 LUFS.", { frente: "cod" });
    await novo("14-unit-economics", "# Unit economics do COD\n\nMargem e CPA por entrega.", { tipo: "fato", frente: "cod" });
  });

  it("acha com e sem acento, título pesando mais", async () => {
    const comAcento = await buscar("tradução");
    expect(comAcento.map((r) => r.slug)).toEqual(["05-traducao-de-criativos", "08-voz"]);
    const semAcento = await buscar("traducao");
    expect(semAcento.map((r) => r.slug)).toEqual(["05-traducao-de-criativos", "08-voz"]);
    // Trecho do texto original, com acento.
    expect(comAcento[0].trecho).toContain("Tradução de criativos");
    expect(semAcento[1].trecho).toContain("A traducao da fala");
    expect((await buscar("musica"))[0].trecho).toContain("Música");
  });

  it("filtra por frente e tipo, limita e cai para pedaço de palavra", async () => {
    expect((await buscar("traducao", { frente: "cod" })).map((r) => r.slug)).toEqual(["08-voz"]);
    expect((await buscar("cod", { tipo: "fato" })).map((r) => r.slug)).toEqual(["14-unit-economics"]);
    expect(await buscar("traducao", { limite: 1 })).toHaveLength(1);
    // "lipsy" não é palavra inteira: só o ILIKE acha.
    expect((await buscar("lipsy")).map((r) => r.slug)).toEqual(["05-traducao-de-criativos"]);
    expect(await buscar("inexistentexyz")).toEqual([]);
    expect(await buscar("   ")).toEqual([]);
  });

  it("trecho tem cerca de 300 caracteres em volta do termo", () => {
    const longo = `${"palavra ".repeat(100)}AQUI está o termo procurado ${"depois ".repeat(100)}`;
    const t = trechoEmVolta(longo, ["termo"]);
    expect(t).toContain("termo procurado");
    expect(t.length).toBeLessThanOrEqual(305);
    expect(t.startsWith("…") && t.endsWith("…")).toBe(true);
  });
});

describe("memória: projetos e lições", () => {
  beforeEach(async () => {
    await bancoDeTeste();
  });

  it("registrarProjeto aparece no índice de projetos e atualiza sem reescrever", async () => {
    const doc = await registrarProjeto(
      { slug: "dewalt-cl", titulo: "DeWalt taladro", frente: "cod", mercado: "Chile", status: "em produção", data: "2026-10-09", conteudo: "Kit DeWalt para o Chile." },
      ana,
    );
    expect(doc).toMatchObject({ slug: "projeto-dewalt-cl", tipo: "projeto", frente: "cod", mercado: "Chile" });
    expect(doc.conteudo).toMatch(/^# DeWalt taladro\n\n> .+\n\n## Contexto de uso\n[\s\S]*Kit DeWalt[\s\S]*## Lógica de uso/);

    const atualizado = await registrarProjeto(
      { slug: "projeto-dewalt-cl", titulo: "DeWalt taladro", frente: "cod", mercado: "Chile", status: "entregue", data: "2026-10-12", conteudo: "Entregues 12 ADs." },
      bia,
    );
    expect(atualizado.versao).toBe(2);
    expect(atualizado.conteudo).toContain("Kit DeWalt para o Chile.");
    expect(atualizado.conteudo).toContain("## Atualização: entregue (2026-10-12)");

    const indice = await indiceDeProjetos();
    expect(indice).toEqual([expect.objectContaining({ slug: "projeto-dewalt-cl", titulo: "DeWalt taladro", frente: "cod", mercado: "Chile", status: "entregue", data: "2026-10-12" })]);
    await expect(registrarProjeto({ slug: "x", titulo: "X", frente: "cod", status: "ok", data: "12/10/2026", conteudo: "x" }, ana)).rejects.toThrow(/AAAA-MM-DD/);
  });

  it("registrarLicao acrescenta linha numerada na tabela e seção no relacionado", async () => {
    await salvar(
      {
        slug: SLUG_LICOES,
        conteudo: "# Lições\n\n## Contexto de uso\n\n| # | O que aconteceu | Regra que ficou |\n|---|---|---|\n| 1 | A | B |\n| 2 | C | D |\n\n## Lógica de uso\n\n1. Ler.\n",
        versaoEsperada: null,
        tipo: "licao",
      },
      ana,
    );
    await novo("09-lipsync", "# Lipsync\n\nTexto.");
    const doc = await registrarLicao(
      { titulo: "Boca mole", data: "2026-10-14", oQueAconteceu: "Lipsync | ficou mole", regra: "Colar só a boca", relacionado: "09-lipsync" },
      bia,
    );
    expect(doc.conteudo).toContain("| 2 | C | D |\n| 3 | **2026-10-14 · Boca mole:** Lipsync \\| ficou mole | Colar só a boca |\n\n## Lógica de uso");
    expect((await ler("09-lipsync"))?.conteudo).toMatch(/## Lição: Boca mole \(\d{4}-\d{2}-\d{2}\)[\s\S]*Colar só a boca/);
    await expect(registrarLicao({ titulo: "x", data: "2026-10-14", oQueAconteceu: "a", regra: "b", relacionado: "nao-existe" }, bia)).rejects.toBeInstanceOf(DocNaoEncontrado);
  });

  it("registrarLicao cria o documento de lições se ainda não existe", async () => {
    const doc = await registrarLicao({ titulo: "Primeira", data: "2026-10-15", oQueAconteceu: "Algo deu errado", regra: "Faça certo" }, ana);
    expect(doc).toMatchObject({ slug: SLUG_LICOES, tipo: "licao", versao: 1 });
    expect(doc.conteudo).toContain("| 1 | **2026-10-15 · Primeira:** Algo deu errado | Faça certo |");
    expect(inserirLicao("# Sem tabela\n", { titulo: "T", data: "2026-10-15", oQueAconteceu: "a", regra: "b" })).toContain("## Lição: T (2026-10-15)");
  });
});

describe("memória: links entre documentos", () => {
  it("troca links .md do repositório antigo pelo endereço do documento", () => {
    const existe = (s: string) => ["05-traducao-de-criativos", "projeto-dewalt-ads-cl", "leia-primeiro", "modelo-de-documento"].includes(s);
    const md = "[a](../05-traducao-de-criativos.md) [b](projetos/dewalt-ads-cl.md) [c](README.md) [d](../_MODELO.md) [e](https://x.com/a.md) [f](sumiu.md)";
    expect(trocarLinksMd(md, existe)).toBe(
      "[a](/memoria/05-traducao-de-criativos) [b](/memoria/projeto-dewalt-ads-cl) [c](/memoria/leia-primeiro) [d](/memoria/modelo-de-documento) [e](https://x.com/a.md) f",
    );
  });
});
