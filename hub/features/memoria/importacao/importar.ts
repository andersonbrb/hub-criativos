import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Autor, Frente, TipoDoc } from "@/features/memoria/contrato";
import { historico, ler, salvar, sha256 } from "@/features/memoria/servicos/memoria";
import { normalizar, normalizarConteudo, tituloDoMarkdown } from "@/features/memoria/texto";

// Importa o repositório contexto-savio e os playbooks do hub para a Memória (scripts/importar-memoria.ts).
// Idempotente: um texto que o documento já teve (em qualquer versão) é pulado. Assim rodar de novo não duplica nada
// e não desfaz uma edição feita depois na tela; só um texto novo da origem vira versão nova ("reimportado").

export type ItemImportacao = {
  slug: string;
  arquivo: string;
  titulo: string;
  tipo: TipoDoc;
  frente: Frente;
  mercado: string | null;
  noPrompt: boolean;
  precisaRevisao: boolean;
  metadados: Record<string, unknown>;
  autor: Autor;
};

export type ResultadoImportacao = {
  commit: string;
  criados: string[];
  atualizados: string[];
  iguais: string[];
  recusados: { slug: string; erro: string }[];
};

type Classe = Pick<ItemImportacao, "tipo" | "frente" | "noPrompt"> & { motivoRevisao?: string };

const MOTIVO_21 =
  "o repositório contexto-savio deixou de existir: a memória agora mora no Hub (tela Memória e conector do Claude Code). Revisar este fluxo.";

// Mapa fixo dos arquivos contexto/NN-*.md (tipo, frente e se entra no prompt dos agentes).
function classeDoContexto(nome: string): Classe {
  const n = Number(nome.slice(0, 2));
  const c = (tipo: TipoDoc, frente: Frente = "geral", noPrompt = false): Classe => ({ tipo, frente, noPrompt });
  if (n === 1) return c("fato", "geral", true);
  if (n === 2 || n === 3) return c("regra", "geral", true);
  if ((n >= 4 && n <= 11) || n === 17 || n === 19) return c("fluxo");
  if (n === 14 || n === 15) return c("fato", "cod");
  if ([12, 13, 16, 18, 20].includes(n)) return c("fato");
  if (n === 21) return { ...c("regra"), motivoRevisao: MOTIVO_21 };
  if (n === 22) return c("licao");
  return { ...c("fato"), motivoRevisao: "Arquivo novo do contexto, fora do mapa da importação: confira o tipo, a frente e se entra no prompt." };
}

// Playbooks do hub: frente pelo nome do arquivo. As versões antigas (playbooks/historico/, inclusive o retrato
// "Contexto Grupo Chegou" de 06/10) não são importadas: a pasta de histórico não é lida.
const PLAYBOOKS: Record<string, Partial<Classe> & { titulo?: string }> = {
  // O primeiro "#" deste arquivo é uma seção ("Como agir"), não o título.
  "dropshipping-cod-criativos": { titulo: "Produtor de criativos COD (dropshipping)" },
};

function frenteDoPlaybook(nome: string): Frente {
  if (nome.includes("infoproduto")) return "info";
  if (nome.includes("dropshipping") || nome.includes("cod")) return "cod";
  return "geral";
}

type LinhaDoIndice = { frente: Frente; frenteOriginal: string; mercado: string | null; periodo: string; data: string | null; status: string };

function frenteDaTabela(texto: string): Frente {
  const t = normalizar(texto).trim();
  if (t.startsWith("cod")) return "cod";
  if (t.startsWith("infoproduto")) return "info";
  if (t.startsWith("x1")) return "x1";
  return "geral";
}

// "03–05/10/2026" → 2026-10-03; "04/10 e 08/10/2026" → 2026-10-04. Sem dia e mês legíveis, null.
export function primeiraData(periodo: string): string | null {
  const ano = periodo.match(/\d{4}/g)?.pop();
  const m = periodo.match(/(\d{1,2})(?:\s*[–-]\s*\d{1,2})?\/(\d{1,2})/);
  return ano && m ? `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

// Tabela do 00-indice-projetos.md (Projeto | Frente | Mercado | Data | Status | Arquivo), pelo nome do arquivo.
export function lerIndiceDeProjetos(md: string): Map<string, LinhaDoIndice> {
  const linhas = md.split("\n").filter((l) => l.trimStart().startsWith("|"));
  const celulas = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const cabecalho = linhas.find((l) => /arquivo/i.test(l) && /status/i.test(l));
  const mapa = new Map<string, LinhaDoIndice>();
  if (!cabecalho) return mapa;
  const nomes = celulas(cabecalho).map((c) => normalizar(c));
  const col = (n: string) => nomes.indexOf(n);
  for (const l of linhas) {
    const c = celulas(l);
    const arquivo = c[col("arquivo")]?.match(/\(([^)]+\.md)\)/)?.[1];
    if (!arquivo) continue;
    const periodo = c[col("data")] ?? "";
    const frenteOriginal = c[col("frente")] ?? "";
    mapa.set(path.basename(arquivo, ".md"), {
      frente: frenteDaTabela(frenteOriginal),
      frenteOriginal,
      mercado: c[col("mercado")] || null,
      periodo,
      data: primeiraData(periodo),
      status: c[col("status")] ?? "",
    });
  }
  return mapa;
}

const listarMd = async (pasta: string) =>
  existsSync(pasta) ? (await readdir(pasta)).filter((n) => n.toLowerCase().endsWith(".md")).sort() : [];

const lerTexto = async (arquivo: string) => normalizarConteudo(await readFile(arquivo, "utf8"));

export async function commitDaPasta(pasta: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", pasta, "rev-parse", "--short", "HEAD"], { timeout: 10_000 });
    return stdout.trim() || "sem commit";
  } catch {
    return "sem commit";
  }
}

export type OpcoesImportacao = {
  // Pasta do repositório contexto-savio (com README.md e contexto/).
  pastaSavio: string;
  // Padrão: hub/playbooks e o decisoes-pendentes.md desta pasta, a partir da pasta do hub (cwd do npm run).
  pastaPlaybooks?: string;
  arquivoDecisoes?: string;
  commit?: string;
};

// O que vai ser importado, sem gravar nada.
export async function planoDeImportacao(opcoes: OpcoesImportacao): Promise<{ commit: string; itens: (ItemImportacao & { conteudo: string })[] }> {
  const raiz = opcoes.pastaSavio;
  const contexto = path.join(raiz, "contexto");
  if (!existsSync(path.join(raiz, "README.md")) || !existsSync(contexto))
    throw new Error(`A pasta "${raiz}" não parece o repositório contexto-savio (falta README.md ou contexto/).`);
  const pastaPlaybooks = opcoes.pastaPlaybooks ?? path.join(process.cwd(), "playbooks");
  const arquivoDecisoes = opcoes.arquivoDecisoes ?? path.join(process.cwd(), "features", "memoria", "importacao", "decisoes-pendentes.md");
  const commit = opcoes.commit ?? (await commitDaPasta(raiz));
  const savio: Autor = { id: null, nome: `Sávio (contexto-savio, commit ${commit})` };
  const hub: Autor = { id: null, nome: "Hub (playbooks)" };
  const itens: (ItemImportacao & { conteudo: string })[] = [];

  // De onde veio o texto (ex.: contexto-savio/contexto/05-traducao-de-criativos.md, playbooks/…).
  const origem = (arquivo: string) => {
    const doSavio = path.relative(raiz, arquivo);
    const rel = doSavio.startsWith("..") || path.isAbsolute(doSavio) ? path.relative(process.cwd(), arquivo) : `contexto-savio/${doSavio}`;
    return rel.replaceAll("\\", "/");
  };

  const add = async (arquivo: string, slug: string, classe: Classe, autor: Autor, extra: Partial<ItemImportacao> = {}) => {
    const conteudo = await lerTexto(arquivo);
    const { motivoRevisao, ...resto } = classe;
    itens.push({
      slug,
      arquivo,
      titulo: extra.titulo ?? tituloDoMarkdown(conteudo) ?? slug,
      mercado: null,
      ...resto,
      ...extra,
      precisaRevisao: Boolean(motivoRevisao),
      metadados: { ...(extra.metadados ?? {}), origem: origem(arquivo), ...(motivoRevisao ? { motivoRevisao } : {}) },
      autor,
      conteudo,
    });
  };

  await add(path.join(raiz, "README.md"), "leia-primeiro", { tipo: "regra", frente: "geral", noPrompt: true }, savio);

  for (const nome of await listarMd(contexto)) {
    const base = path.basename(nome, ".md");
    const arquivo = path.join(contexto, nome);
    if (base === "_MODELO") await add(arquivo, "modelo-de-documento", { tipo: "regra", frente: "geral", noPrompt: false }, savio);
    else await add(arquivo, base.toLowerCase(), classeDoContexto(base), savio);
  }

  const pastaProjetos = path.join(contexto, "projetos");
  const nomeIndice = "00-indice-projetos.md";
  const indice = existsSync(path.join(pastaProjetos, nomeIndice)) ? lerIndiceDeProjetos(await lerTexto(path.join(pastaProjetos, nomeIndice))) : new Map();
  for (const nome of await listarMd(pastaProjetos)) {
    const base = path.basename(nome, ".md");
    const arquivo = path.join(pastaProjetos, nome);
    if (nome === nomeIndice) {
      await add(arquivo, "projetos-indice-original", { tipo: "fato", frente: "geral", noPrompt: false }, savio);
      continue;
    }
    const linha = indice.get(base);
    const classe: Classe = linha
      ? { tipo: "projeto", frente: linha.frente, noPrompt: false }
      : { tipo: "projeto", frente: "geral", noPrompt: false, motivoRevisao: "Projeto fora da tabela do índice original: confira frente, mercado, status e data." };
    await add(arquivo, `projeto-${base.toLowerCase()}`, classe, savio, {
      mercado: linha?.mercado ?? null,
      metadados: linha
        ? { status: linha.status, data: linha.data, mercado: linha.mercado, periodo: linha.periodo, frenteOriginal: linha.frenteOriginal }
        : {},
    });
  }

  for (const nome of await listarMd(pastaPlaybooks)) {
    const base = path.basename(nome, ".md");
    if (base.toLowerCase() === "readme") continue;
    const { titulo, ...fixo } = PLAYBOOKS[base] ?? {};
    await add(path.join(pastaPlaybooks, nome), `playbook-${base.toLowerCase()}`, { tipo: "playbook", frente: frenteDoPlaybook(base), noPrompt: true, ...fixo }, hub, titulo ? { titulo } : {});
  }

  // Fechado em 20/10/2026 (vale o contexto do Sávio): entra no prompt dos agentes.
  if (existsSync(arquivoDecisoes)) {
    await add(arquivoDecisoes, "decisoes-pendentes", { tipo: "decisao", frente: "geral", noPrompt: true }, { id: null, nome: "Hub (importação)" });
  }

  return { commit, itens };
}

export async function importarMemoria(opcoes: OpcoesImportacao): Promise<ResultadoImportacao> {
  const { commit, itens } = await planoDeImportacao(opcoes);
  const r: ResultadoImportacao = { commit, criados: [], atualizados: [], iguais: [], recusados: [] };
  for (const item of itens) {
    try {
      const atual = await ler(item.slug);
      if (!atual) {
        await salvar(
          {
            slug: item.slug,
            conteudo: item.conteudo,
            versaoEsperada: null,
            titulo: item.titulo,
            tipo: item.tipo,
            frente: item.frente,
            mercado: item.mercado,
            noPrompt: item.noPrompt,
            precisaRevisao: item.precisaRevisao,
            metadados: item.metadados,
            nota: "importado",
          },
          item.autor,
        );
        r.criados.push(item.slug);
        continue;
      }
      const hash = sha256(item.conteudo);
      if (sha256(atual.conteudo) === hash || (await historico(item.slug)).some((v) => v.sha === hash)) {
        r.iguais.push(item.slug);
        continue;
      }
      await salvar({ slug: item.slug, conteudo: item.conteudo, versaoEsperada: atual.versao, nota: "reimportado" }, item.autor);
      r.atualizados.push(item.slug);
    } catch (err) {
      r.recusados.push({ slug: item.slug, erro: err instanceof Error ? err.message : String(err) });
    }
  }
  return r;
}
