import "server-only";

import { createHash } from "node:crypto";

import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { memoriaDocumentos as docs, memoriaVersoes as versoes } from "@/db/schema";
import {
  DATA_ISO,
  ehFrente,
  ehTipo,
  FRENTE_ROTULO,
  FRENTES,
  hojeISO,
  LIMITE_BUSCA,
  LIMITE_BUSCA_MAX,
  SLUG_VALIDO,
  SLUGS_RESERVADOS,
  TIPOS,
  type Autor,
  type Doc,
  type DocResumo,
  type EntradaLicao,
  type EntradaProjeto,
  type EntradaSalvar,
  type FiltroDocs,
  type LinhaProjeto,
  type ResultadoBusca,
  type TipoDoc,
  type Versao,
} from "@/features/memoria/contrato";
import { ConflitoDeVersao, DocNaoEncontrado } from "@/features/memoria/erros";
import { barrarSegredos } from "@/features/memoria/servicos/segredos";
import { normalizar, normalizarConteudo, slugDoArquivo, termosDaConsulta, textoDeBusca, tituloDoMarkdown, trechoEmVolta } from "@/features/memoria/texto";
import { InputError } from "@/lib/server/http";

// Serviços da Memória. Contrato estável: as assinaturas das funções do contrato não mudam.
// Tudo que grava passa por salvar(): é lá que ficam a barreira de segredo, o controle de versão e o histórico.
// Toda consulta é da organização em que o código está rodando (features/acesso/servicos/organizacao-atual.ts): uma
// organização nunca lê nem grava a memória da outra.

const daOrganizacao = async () => eq(docs.organizacaoId, await organizacaoAtual());

type LinhaDoc = typeof docs.$inferSelect;

// Colunas do resumo (sem o conteúdo, que pode ser grande).
const colunasResumo = {
  slug: docs.slug,
  titulo: docs.titulo,
  tipo: docs.tipo,
  frente: docs.frente,
  mercado: docs.mercado,
  noPrompt: docs.noPrompt,
  precisaRevisao: docs.precisaRevisao,
  versaoAtual: docs.versaoAtual,
  atualizadoEm: docs.atualizadoEm,
  metadados: docs.metadados,
};
type LinhaResumo = Pick<LinhaDoc, keyof typeof colunasResumo>;

const paraResumo = (l: LinhaResumo): DocResumo => ({
  slug: l.slug,
  titulo: l.titulo,
  tipo: l.tipo,
  frente: l.frente,
  mercado: l.mercado,
  noPrompt: l.noPrompt,
  precisaRevisao: l.precisaRevisao,
  versao: l.versaoAtual,
  atualizadoEm: l.atualizadoEm.toISOString(),
  metadados: l.metadados ?? {},
});

const paraDoc = (l: LinhaDoc): Doc => ({ ...paraResumo(l), conteudo: l.conteudoAtual, autor: l.autorAtual });

const ordenar = <T extends { tipo: TipoDoc; slug: string }>(lista: T[]) =>
  lista.sort((a, b) => TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo) || a.slug.localeCompare(b.slug));

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_CONTEUDO = 400_000;
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const linha = (v: unknown) => texto(v).replace(/\s+/g, " ");

function validarAutor(autor: Autor): { id: string | null; nome: string } {
  const nome = linha(autor?.nome);
  if (!nome) throw new InputError("Falta o nome de quem está gravando.");
  // Só conta do hub (uuid) vira autor_id; processos e nomes soltos ficam só com o nome.
  return { id: typeof autor.id === "string" && UUID.test(autor.id) ? autor.id : null, nome: nome.slice(0, 200) };
}

function validarFiltro(filtro?: FiltroDocs): SQL | undefined {
  const conds: SQL[] = [];
  if (filtro?.tipo) {
    if (!ehTipo(filtro.tipo)) throw new InputError(`Tipo inválido: "${filtro.tipo}". Use um destes: ${TIPOS.join(", ")}.`);
    conds.push(eq(docs.tipo, filtro.tipo));
  }
  if (filtro?.frente) {
    if (!ehFrente(filtro.frente)) throw new InputError(`Frente inválida: "${filtro.frente}". Use uma destas: ${FRENTES.join(", ")}.`);
    conds.push(eq(docs.frente, filtro.frente));
  }
  return conds.length ? and(...conds) : undefined;
}

function validarSlug(v: unknown): string {
  const slug = texto(v);
  if (!SLUG_VALIDO.test(slug))
    throw new InputError(`Nome (slug) inválido: "${slug}". Use letras minúsculas, números e hífen, como 05-traducao-de-criativos.`);
  if ((SLUGS_RESERVADOS as readonly string[]).includes(slug)) throw new InputError(`"${slug}" é um nome reservado da Memória. Escolha outro.`);
  return slug;
}

function validarVersao(v: unknown, campo = "versão"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InputError(`A ${campo} precisa ser um número inteiro a partir de 1.`);
  return n;
}

type EntradaValida = Omit<EntradaSalvar, "conteudo"> & { conteudo: string };

function validarEntrada(e: EntradaSalvar): EntradaValida {
  if (!e || typeof e !== "object") throw new InputError("Entrada inválida.");
  const slug = validarSlug(e.slug);
  if (typeof e.conteudo !== "string" || !e.conteudo.trim()) throw new InputError("O conteúdo do documento está vazio.");
  if (e.conteudo.length > LIMITE_CONTEUDO) throw new InputError(`Documento grande demais (máximo ${LIMITE_CONTEUDO.toLocaleString("pt-BR")} caracteres). Divida em dois.`);
  const versaoEsperada = e.versaoEsperada === null ? null : validarVersao(e.versaoEsperada, "versão lida (versaoEsperada)");
  if (e.tipo !== undefined && !ehTipo(e.tipo)) throw new InputError(`Tipo inválido: "${e.tipo}". Use um destes: ${TIPOS.join(", ")}.`);
  if (e.frente !== undefined && !ehFrente(e.frente)) throw new InputError(`Frente inválida: "${e.frente}". Use uma destas: ${FRENTES.join(", ")}.`);
  if (e.metadados !== undefined && (e.metadados === null || typeof e.metadados !== "object" || Array.isArray(e.metadados)))
    throw new InputError("Os metadados precisam ser um objeto.");
  const titulo = e.titulo === undefined ? undefined : linha(e.titulo).slice(0, 200) || undefined;
  const mercado = e.mercado === undefined ? undefined : e.mercado === null ? null : linha(e.mercado).slice(0, 200) || null;
  return {
    ...e,
    slug,
    conteudo: normalizarConteudo(e.conteudo),
    versaoEsperada,
    titulo,
    mercado,
    noPrompt: e.noPrompt === undefined ? undefined : Boolean(e.noPrompt),
    precisaRevisao: e.precisaRevisao === undefined ? undefined : Boolean(e.precisaRevisao),
    nota: e.nota === undefined ? undefined : linha(e.nota).slice(0, 500) || undefined,
  };
}

export async function listarIndice(filtro?: FiltroDocs): Promise<DocResumo[]> {
  const linhas = await banco()
    .select(colunasResumo)
    .from(docs)
    .where(and(await daOrganizacao(), validarFiltro(filtro)));
  return ordenar(linhas.map(paraResumo));
}

export async function buscar(consulta: string, filtro?: FiltroDocs & { limite?: number }): Promise<ResultadoBusca[]> {
  const q = normalizar(typeof consulta === "string" ? consulta : "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!q) return [];
  const limite = Math.min(LIMITE_BUSCA_MAX, Math.max(1, Math.floor(Number(filtro?.limite) || LIMITE_BUSCA)));
  const condFiltro = and(await daOrganizacao(), validarFiltro(filtro));
  const termos = termosDaConsulta(q);
  const colunas = { ...colunasResumo, conteudo: docs.conteudoAtual };

  // Busca por palavra inteira (índice GIN). O título fica na 1ª linha da coluna de busca e pesa mais (peso A).
  const consultaTs = sql`websearch_to_tsquery('simple', ${q})`;
  const vetor = sql`to_tsvector('simple', ${docs.busca})`;
  const relevancia = sql`ts_rank(setweight(to_tsvector('simple', split_part(${docs.busca}, chr(10), 1)), 'A') || setweight(${vetor}, 'D'), ${consultaTs})`;
  const achados = await banco()
    .select(colunas)
    .from(docs)
    .where(and(sql`${vetor} @@ ${consultaTs}`, condFiltro))
    .orderBy(sql`${relevancia} desc`, docs.slug)
    .limit(limite);

  let linhas = achados;
  if (!linhas.length && termos.length) {
    // Nada por palavra inteira: tenta pedaço de palavra ("lipsy" acha "lipsync"), qualquer termo.
    // Os termos só têm letras e números (termosDaConsulta), então não há % nem _ para escapar.
    const candidatos = await banco()
      .select({ ...colunas, busca: docs.busca })
      .from(docs)
      .where(and(or(...termos.map((t) => sql`${docs.busca} ilike ${`%${t}%`}`)), condFiltro))
      .limit(200);
    const nota = (l: (typeof candidatos)[number]) => {
      const [tituloNorm] = l.busca.split("\n", 1);
      return termos.reduce((s, t) => s + (tituloNorm.includes(t) ? 3 : 0) + (l.busca.includes(t) ? 1 : 0), 0);
    };
    linhas = candidatos
      .map((l) => ({ l, n: nota(l) }))
      .sort((a, b) => b.n - a.n || a.l.slug.localeCompare(b.l.slug))
      .slice(0, limite)
      .map(({ l }) => l);
  }

  return linhas.map((l) => ({ ...paraResumo(l), trecho: trechoEmVolta(l.conteudo, termos) }));
}

// versao ausente = a mais recente.
export async function ler(slug: string, versao?: number): Promise<Doc | null> {
  const [d] = await banco()
    .select()
    .from(docs)
    .where(and(await daOrganizacao(), eq(docs.slug, texto(slug))))
    .limit(1);
  if (!d) return null;
  if (versao === undefined || versao === null) return paraDoc(d);
  const n = validarVersao(versao);
  if (n === d.versaoAtual) return paraDoc(d);
  const [v] = await banco()
    .select()
    .from(versoes)
    .where(and(eq(versoes.docId, d.id), eq(versoes.versao, n)))
    .limit(1);
  if (!v) return null;
  return { ...paraDoc(d), conteudo: v.conteudo, versao: v.versao, autor: v.autorNome, atualizadoEm: v.criadoEm.toISOString() };
}

// Slug de um documento a partir do que um agente escreveu: o próprio slug, ou o nome de arquivo do repositório
// antigo que aparece nos links dos textos ("projetos/dewalt-ads-cl.md" → projeto-dewalt-ads-cl). null se não achar.
export async function resolverSlug(entrada: string): Promise<string | null> {
  const bruto = texto(entrada);
  if (!bruto) return null;
  const org = await daOrganizacao();
  const [direto] = await banco()
    .select({ slug: docs.slug })
    .from(docs)
    .where(and(org, eq(docs.slug, bruto)))
    .limit(1);
  if (direto) return direto.slug;
  const slugs = new Set((await banco().select({ slug: docs.slug }).from(docs).where(org)).map((d) => d.slug));
  return slugDoArquivo(`${bruto.replace(/\.md$/i, "")}.md`, (s) => slugs.has(s));
}

export async function salvar(entrada: EntradaSalvar, autor: Autor): Promise<Doc> {
  const e = validarEntrada(entrada);
  const quem = validarAutor(autor);
  barrarSegredos(e.titulo, e.conteudo, e.mercado, e.nota, e.metadados && JSON.stringify(e.metadados));
  const hash = sha256(e.conteudo);
  const organizacaoId = await organizacaoAtual();

  return banco().transaction(async (tx) => {
    const [atual] = await tx
      .select()
      .from(docs)
      .where(and(eq(docs.organizacaoId, organizacaoId), eq(docs.slug, e.slug)))
      .limit(1);

    if (e.versaoEsperada === null) {
      if (atual) throw new ConflitoDeVersao(e.slug, atual.versaoAtual, null);
      if (!e.tipo) throw new InputError(`Diga o tipo do documento novo: ${TIPOS.join(", ")}.`);
      const titulo = e.titulo ?? tituloDoMarkdown(e.conteudo) ?? e.slug;
      // ON CONFLICT: se outra pessoa criou o mesmo slug ao mesmo tempo, só uma criação passa.
      const [novo] = await tx
        .insert(docs)
        .values({
          organizacaoId,
          slug: e.slug,
          titulo,
          tipo: e.tipo,
          frente: e.frente ?? "geral",
          mercado: e.mercado ?? null,
          noPrompt: e.noPrompt ?? false,
          precisaRevisao: e.precisaRevisao ?? false,
          metadados: e.metadados ?? {},
          versaoAtual: 1,
          conteudoAtual: e.conteudo,
          autorAtual: quem.nome,
          busca: textoDeBusca(titulo, e.conteudo),
        })
        .onConflictDoNothing({ target: [docs.organizacaoId, docs.slug] })
        .returning();
      if (!novo) throw new ConflitoDeVersao(e.slug, 1, null);
      await tx.insert(versoes).values({
        docId: novo.id,
        versao: 1,
        conteudo: e.conteudo,
        sha256: hash,
        autorId: quem.id,
        autorNome: quem.nome,
        nota: e.nota ?? "criado",
      });
      return paraDoc(novo);
    }

    if (!atual) throw new DocNaoEncontrado(e.slug);
    if (atual.versaoAtual !== e.versaoEsperada) throw new ConflitoDeVersao(e.slug, atual.versaoAtual, e.versaoEsperada);

    const mudouTexto = e.conteudo !== atual.conteudoAtual;
    const campos: Partial<LinhaDoc> = {};
    if (e.titulo !== undefined && e.titulo !== atual.titulo) campos.titulo = e.titulo;
    if (e.tipo !== undefined && e.tipo !== atual.tipo) campos.tipo = e.tipo;
    if (e.frente !== undefined && e.frente !== atual.frente) campos.frente = e.frente;
    if (e.mercado !== undefined && e.mercado !== atual.mercado) campos.mercado = e.mercado;
    if (e.noPrompt !== undefined && e.noPrompt !== atual.noPrompt) campos.noPrompt = e.noPrompt;
    if (e.precisaRevisao !== undefined && e.precisaRevisao !== atual.precisaRevisao) campos.precisaRevisao = e.precisaRevisao;
    if (e.metadados !== undefined && JSON.stringify(e.metadados) !== JSON.stringify(atual.metadados)) campos.metadados = e.metadados;
    // Conteúdo igual e nada mais mudou: não grava nada (nem versão nova).
    if (!mudouTexto && !Object.keys(campos).length) return paraDoc(atual);

    const titulo = campos.titulo ?? atual.titulo;
    const versao = mudouTexto ? atual.versaoAtual + 1 : atual.versaoAtual;
    // Update condicional: com duas gravações sobre a mesma versão, a segunda não acha mais a linha e vira conflito.
    const [salvo] = await tx
      .update(docs)
      .set({
        ...campos,
        conteudoAtual: e.conteudo,
        versaoAtual: versao,
        autorAtual: mudouTexto ? quem.nome : atual.autorAtual,
        busca: textoDeBusca(titulo, e.conteudo),
        atualizadoEm: new Date(),
      })
      .where(and(eq(docs.id, atual.id), eq(docs.versaoAtual, e.versaoEsperada)))
      .returning();
    if (!salvo) {
      const [agora] = await tx.select({ v: docs.versaoAtual }).from(docs).where(eq(docs.id, atual.id));
      throw new ConflitoDeVersao(e.slug, agora?.v ?? atual.versaoAtual + 1, e.versaoEsperada);
    }
    if (mudouTexto) {
      await tx.insert(versoes).values({
        docId: atual.id,
        versao,
        conteudo: e.conteudo,
        sha256: hash,
        autorId: quem.id,
        autorNome: quem.nome,
        nota: e.nota ?? null,
      });
    }
    return paraDoc(salvo);
  });
}

// Lê a versão atual e grava a mudança sobre ela. Se outra gravação passar na frente, tenta de novo com o texto
// novo (até 3 vezes): acrescentar não depende do que a pessoa leu, então não precisa devolver conflito.
async function gravarSobreAtual(slug: string, mudar: (atual: Doc) => Omit<EntradaSalvar, "slug" | "versaoEsperada">, autor: Autor): Promise<Doc> {
  for (let tentativa = 1; ; tentativa++) {
    const atual = await ler(slug);
    if (!atual) throw new DocNaoEncontrado(slug);
    try {
      return await salvar({ ...mudar(atual), slug, versaoEsperada: atual.versao }, autor);
    } catch (err) {
      if (err instanceof ConflitoDeVersao && tentativa < 3) continue;
      throw err;
    }
  }
}

const tituloDeSecao = (v: unknown) => linha(v).replace(/^#+\s*/, "").slice(0, 200);

// Acrescenta uma seção no fim (regra do contexto: acrescentar em vez de reescrever).
export async function acrescentarSecao(slug: string, secao: { titulo: string; conteudo: string }, autor: Autor, nota?: string): Promise<Doc> {
  const titulo = tituloDeSecao(secao?.titulo);
  const corpo = texto(secao?.conteudo);
  if (!titulo) throw new InputError("Falta o título da seção.");
  if (!corpo) throw new InputError("A seção está vazia.");
  return gravarSobreAtual(
    texto(slug),
    (atual) => ({
      conteudo: `${atual.conteudo.trimEnd()}\n\n## ${titulo} (${hojeISO()})\n\n${corpo}\n`,
      nota: nota ?? `seção "${titulo}" acrescentada`,
    }),
    autor,
  );
}

function validarData(v: unknown, campo = "data"): string {
  const data = texto(v);
  if (!DATA_ISO.test(data) || Number.isNaN(Date.parse(data))) throw new InputError(`A ${campo} precisa estar no formato AAAA-MM-DD (ex.: ${hojeISO()}).`);
  return data;
}

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

// Texto de um projeto novo no modelo do contexto (título, linha de resumo, Contexto de uso, Lógica de uso).
// Se o conteúdo já vier no modelo, só garante o título.
function textoDoProjeto(p: Required<Omit<EntradaProjeto, "mercado">> & { mercado: string | null }): string {
  let corpo = p.conteudo.trim().replace(/^#\s+.*\n*/, "");
  const resumo = corpo.startsWith(">")
    ? ""
    : `> Projeto ${FRENTE_ROTULO[p.frente]}${p.mercado ? ` · ${p.mercado}` : ""}. Status: ${p.status} (${dataBR(p.data)}). Abra antes de mexer neste lote.\n\n`;
  if (!/^##\s+Contexto de uso/im.test(corpo)) {
    corpo = [
      "## Contexto de uso",
      `- **Frente:** ${FRENTE_ROTULO[p.frente]}`,
      `- **Mercado:** ${p.mercado ?? "precisa de revisão manual"}`,
      `- **Status:** ${p.status} (${dataBR(p.data)})`,
      "",
      corpo,
      "",
      "## Lógica de uso",
      "Precisa de revisão manual: registre aqui o método, os passos e o que deu errado.",
    ].join("\n");
  }
  return `# ${p.titulo}\n\n${resumo}${corpo}\n`;
}

// Cria ou atualiza o documento do projeto (slug projeto-<slug>). Já existe: atualiza status, data, mercado e frente
// e acrescenta o conteúdo novo como seção datada, sem reescrever o que já estava lá.
export async function registrarProjeto(entrada: EntradaProjeto, autor: Autor): Promise<Doc> {
  const base = texto(entrada?.slug).replace(/^projeto-/, "");
  const slug = validarSlug(`projeto-${base}`);
  const titulo = linha(entrada.titulo).slice(0, 200);
  const status = linha(entrada.status).slice(0, 200);
  const conteudo = texto(entrada.conteudo);
  if (!titulo) throw new InputError("Falta o título do projeto.");
  if (!status) throw new InputError("Falta o status do projeto (ex.: entregue, pausado, validado, vencedor, em produção).");
  if (!conteudo) throw new InputError("Falta o conteúdo do projeto.");
  if (!ehFrente(entrada.frente)) throw new InputError(`Frente inválida: "${entrada.frente}". Use uma destas: ${FRENTES.join(", ")}.`);
  const data = validarData(entrada.data);
  const mercado = entrada.mercado ? linha(entrada.mercado).slice(0, 200) || null : null;
  const p = { slug: base, titulo, frente: entrada.frente, mercado, status, data, conteudo };
  const metadados = { status, data, mercado };

  if (!(await ler(slug))) {
    try {
      return await salvar(
        { slug, conteudo: textoDoProjeto(p), versaoEsperada: null, titulo, tipo: "projeto", frente: p.frente, mercado, metadados, nota: "projeto registrado" },
        autor,
      );
    } catch (err) {
      // Criado por outra gravação no meio do caminho: segue como atualização.
      if (!(err instanceof ConflitoDeVersao)) throw err;
    }
  }
  return gravarSobreAtual(
    slug,
    (atual) => ({
      conteudo: atual.conteudo.includes(conteudo)
        ? atual.conteudo
        : `${atual.conteudo.trimEnd()}\n\n## Atualização: ${status} (${data})\n\n${conteudo}\n`,
      titulo,
      tipo: "projeto",
      frente: p.frente,
      mercado,
      metadados: { ...atual.metadados, ...metadados },
      nota: `projeto atualizado: ${status}`,
    }),
    autor,
  );
}

// Documento das lições (veio do arquivo 22 do Sávio).
export const SLUG_LICOES = "22-licoes-producao-video";

const MODELO_LICOES = `# Lições de produção (o que foi refeito e a regra que ficou)

> Erros que obrigaram a refazer um trabalho e a regra que passou a valer. Leia antes de orçar ou produzir um lote.

## Contexto de uso

| # | O que aconteceu | Regra que ficou |
|---|---|---|

## Lógica de uso

1. Antes de orçar um lote, passe pela tabela e ajuste o plano.
2. Quando surgir um erro novo que obrigue a refazer, registre uma linha nesta tabela, com a data.
`;

const celula = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

// Acrescenta a lição como linha nova da tabela "# | O que aconteceu | Regra". Sem a tabela, vira uma seção no fim.
export function inserirLicao(md: string, l: { titulo: string; data: string; oQueAconteceu: string; regra: string }): string {
  const linhas = md.replace(/\s+$/, "").split("\n");
  const cabecalho = linhas.findIndex((x) => /^\|\s*#\s*\|/.test(x) && /o que aconteceu/i.test(x));
  if (cabecalho >= 0 && /^\|[\s|:-]+\|?\s*$/.test(linhas[cabecalho + 1] ?? "")) {
    let fim = cabecalho + 1;
    while (fim + 1 < linhas.length && linhas[fim + 1].trimStart().startsWith("|")) fim++;
    const numeros = linhas
      .slice(cabecalho + 2, fim + 1)
      .map((x) => Number(x.match(/^\|\s*(\d+)\s*\|/)?.[1]))
      .filter((n) => Number.isFinite(n));
    const n = (numeros.length ? Math.max(...numeros) : 0) + 1;
    linhas.splice(fim + 1, 0, `| ${n} | ${celula(`**${l.data} · ${l.titulo}:** ${l.oQueAconteceu}`)} | ${celula(l.regra)} |`);
    return `${linhas.join("\n")}\n`;
  }
  return `${linhas.join("\n")}\n\n## Lição: ${l.titulo} (${l.data})\n\n- **O que aconteceu:** ${l.oQueAconteceu.trim()}\n- **Regra que ficou:** ${l.regra.trim()}\n`;
}

export async function registrarLicao(entrada: EntradaLicao, autor: Autor): Promise<Doc> {
  const titulo = linha(entrada?.titulo).slice(0, 200);
  const oQueAconteceu = texto(entrada.oQueAconteceu);
  const regra = texto(entrada.regra);
  if (!titulo) throw new InputError("Falta o título da lição.");
  if (!oQueAconteceu) throw new InputError("Falta dizer o que aconteceu.");
  if (!regra) throw new InputError("Falta a regra que ficou.");
  const data = validarData(entrada.data);
  const relacionado = entrada.relacionado ? texto(entrada.relacionado) : null;
  // Confere antes de gravar qualquer coisa, para não deixar a lição pela metade.
  if (relacionado && !(await ler(relacionado))) throw new DocNaoEncontrado(relacionado);
  barrarSegredos(titulo, oQueAconteceu, regra);

  const l = { titulo, data, oQueAconteceu, regra };
  let licoes: Doc | null = null;
  if (!(await ler(SLUG_LICOES))) {
    try {
      licoes = await salvar(
        { slug: SLUG_LICOES, conteudo: inserirLicao(MODELO_LICOES, l), versaoEsperada: null, tipo: "licao", frente: "geral", nota: `lição: ${titulo}` },
        autor,
      );
    } catch (err) {
      if (!(err instanceof ConflitoDeVersao)) throw err;
    }
  }
  licoes ??= await gravarSobreAtual(SLUG_LICOES, (atual) => ({ conteudo: inserirLicao(atual.conteudo, l), nota: `lição: ${titulo}` }), autor);

  if (relacionado && relacionado !== SLUG_LICOES) {
    await acrescentarSecao(
      relacionado,
      { titulo: `Lição: ${titulo}`, conteudo: `**${dataBR(data)}:** ${oQueAconteceu}\n\n**Regra que ficou:** ${regra}\n\nRegistrada em [Lições de produção](/memoria/${SLUG_LICOES}).` },
      autor,
      `lição: ${titulo}`,
    );
  }
  return licoes;
}

export async function historico(slug: string): Promise<Versao[]> {
  const [d] = await banco()
    .select({ id: docs.id })
    .from(docs)
    .where(and(await daOrganizacao(), eq(docs.slug, texto(slug))))
    .limit(1);
  if (!d) throw new DocNaoEncontrado(texto(slug));
  const linhas = await banco()
    .select()
    .from(versoes)
    .where(eq(versoes.docId, d.id))
    .orderBy(sql`${versoes.versao} desc`);
  return linhas.map((v) => ({ versao: v.versao, autor: v.autorNome, nota: v.nota, criadoEm: v.criadoEm.toISOString(), sha: v.sha256 }));
}

// Restaurar cria uma versão NOVA com o conteúdo antigo (nada é apagado).
export async function restaurar(slug: string, versao: number, autor: Autor): Promise<Doc> {
  const n = validarVersao(versao);
  const antiga = await ler(slug, n);
  if (!antiga) {
    if (!(await ler(slug))) throw new DocNaoEncontrado(texto(slug));
    throw new InputError(`A versão ${n} de "${texto(slug)}" não existe. Veja o histórico.`);
  }
  return gravarSobreAtual(texto(slug), () => ({ conteudo: antiga.conteudo, nota: `restaurado da versão ${n}` }), autor);
}

export async function pendentesDeRevisao(): Promise<DocResumo[]> {
  const linhas = await banco()
    .select(colunasResumo)
    .from(docs)
    .where(and(await daOrganizacao(), eq(docs.precisaRevisao, true)));
  return ordenar(linhas.map(paraResumo));
}

// Tira da fila de revisão. Não cria versão (o texto não muda); fica registrado quem revisou e quando.
export async function marcarRevisado(slug: string, autor: Autor): Promise<Doc> {
  const quem = validarAutor(autor);
  const [atual] = await banco()
    .select()
    .from(docs)
    .where(and(await daOrganizacao(), eq(docs.slug, texto(slug))))
    .limit(1);
  if (!atual) throw new DocNaoEncontrado(texto(slug));
  const { motivoRevisao, ...resto } = atual.metadados ?? {};
  const [salvo] = await banco()
    .update(docs)
    .set({
      precisaRevisao: false,
      metadados: { ...resto, revisado: { por: quem.nome, em: hojeISO(), ...(motivoRevisao ? { motivo: motivoRevisao } : {}) } },
      atualizadoEm: new Date(),
    })
    .where(eq(docs.id, atual.id))
    .returning();
  return paraDoc(salvo);
}

// Documentos que entram no prompt de sistema dos agentes do hub (noPrompt = true), na versão mais recente.
export async function documentosDoPrompt(): Promise<Doc[]> {
  const linhas = await banco()
    .select()
    .from(docs)
    .where(and(await daOrganizacao(), eq(docs.noPrompt, true)));
  return ordenar(linhas).map(paraDoc);
}

// Índice de projetos gerado a partir dos documentos tipo "projeto" (substitui a tabela mantida à mão do Sávio).
// Mais recentes primeiro.
export async function indiceDeProjetos(): Promise<LinhaProjeto[]> {
  const linhas = await banco()
    .select(colunasResumo)
    .from(docs)
    .where(and(await daOrganizacao(), eq(docs.tipo, "projeto")));
  const campo = (m: Record<string, unknown>, k: string) => (typeof m[k] === "string" && m[k] ? (m[k] as string) : null);
  return linhas
    .map((l) => {
      const m = l.metadados ?? {};
      return {
        slug: l.slug,
        titulo: l.titulo,
        frente: l.frente,
        frenteOriginal: campo(m, "frenteOriginal"),
        mercado: l.mercado ?? campo(m, "mercado"),
        status: campo(m, "status"),
        data: campo(m, "data"),
        precisaRevisao: l.precisaRevisao,
        atualizadoEm: l.atualizadoEm.toISOString(),
      };
    })
    .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? "") || a.slug.localeCompare(b.slug));
}
