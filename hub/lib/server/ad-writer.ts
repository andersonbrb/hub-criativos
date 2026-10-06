import "server-only";

import { createHash, randomInt } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { InputError } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

// Método "ad-writer-light" (github.com/kretli1/ad-writer-light) dentro do hub, para os agentes de Estrategista e Copy.
// - Base de conhecimento (agentes, tasks, data, checklists...) em hub/knowledge/ad-writer-light (só local, fora do git).
// - Por nicho, em .data/ad-writer/<nicho>/: reference-ads.md (anúncios campeões) e as análises (decode) salvas pelos agentes,
//   com a "impressão digital" das referências para saber quando a análise ficou velha (o protocolo do método).

const KB_DIR = path.join(process.cwd(), "knowledge", "ad-writer-light");
const NICHE_DIR = path.join(DATA_DIR, "ad-writer");
const MAX_READ = 25_000;

// Arquivos de nicho que os agentes podem gravar (os mesmos do método).
export const NICHE_FILES = [
  "reference-ads.md",
  "pattern-analysis.yaml",
  "synthesis-brief.md",
  "sexy-canvas-analysis.yaml",
  "sexy-synthesis-brief.md",
  "sub-personas.yaml",
  "notes.md",
] as const;
type NicheFile = (typeof NICHE_FILES)[number];
const DECODES: NicheFile[] = ["pattern-analysis.yaml", "synthesis-brief.md", "sexy-canvas-analysis.yaml", "sexy-synthesis-brief.md", "sub-personas.yaml"];

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

function kbPath(rel: string) {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^ad-writer-light\//, "");
  const full = path.resolve(KB_DIR, clean);
  if (!full.startsWith(KB_DIR + path.sep)) throw new InputError("Caminho inválido.");
  return full;
}

async function walk(dir: string, base = dir): Promise<{ path: string; size: number }[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: { path: string; size: number }[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push({ path: path.relative(base, full).replace(/\\/g, "/"), size: (await stat(full)).size });
  }
  return out;
}

export async function kbFiles() {
  const files = await walk(KB_DIR);
  if (!files.length) throw new InputError("A base do ad-writer-light não está instalada (pasta hub/knowledge/ad-writer-light).");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// Lê um arquivo da base em pedaços (alguns têm mais de 100 mil caracteres): offset em caracteres.
export async function kbRead(rel: string, offset = 0, maxChars = MAX_READ) {
  const text = await readFile(kbPath(rel), "utf8").catch(() => {
    throw new InputError(`Arquivo não encontrado: ${rel}. Use action=files.`);
  });
  const start = Math.max(0, Math.min(offset, text.length));
  const end = Math.min(text.length, start + Math.min(MAX_READ, Math.max(1000, maxChars)));
  return { path: rel, total_chars: text.length, offset: start, next_offset: end < text.length ? end : null, text: text.slice(start, end) };
}

// Busca simples (todas as palavras na mesma linha), com o número da linha para ler o trecho certo depois.
export async function kbSearch(query: string, limit = 30) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new InputError("Informe o que procurar.");
  const hits: { path: string; line: number; offset: number; text: string }[] = [];
  for (const f of await kbFiles()) {
    const text = await readFile(kbPath(f.path), "utf8");
    let offset = 0;
    for (const [i, line] of text.split("\n").entries()) {
      const low = line.toLowerCase();
      if (words.every((w) => low.includes(w))) hits.push({ path: f.path, line: i + 1, offset, text: line.trim().slice(0, 240) });
      offset += line.length + 1;
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

// ---------- Nichos (referências e análises) ----------

type Meta = { refsSha: string | null; refCount: number; decodes: Partial<Record<NicheFile, { sha: string | null; savedAt: string }>> };

const nicheDir = (niche: string) => {
  const s = slug(niche);
  if (!s) throw new InputError("Informe o nicho (ex.: garrafa-termica-cl).");
  return path.join(NICHE_DIR, s);
};
const metaOf = async (dir: string): Promise<Meta> =>
  JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8").catch(() => '{"refsSha":null,"refCount":0,"decodes":{}}')) as Meta;
const countRefs = (text: string) => (text.match(/^## Ad\b/gm) ?? []).length;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export async function listNiches() {
  const names = (await readdir(NICHE_DIR, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
  return Promise.all(
    names.map(async (name) => {
      const dir = path.join(NICHE_DIR, name);
      const meta = await metaOf(dir);
      const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f !== "meta.json");
      return {
        niche: name,
        ref_count: meta.refCount,
        files: files.map((f) => {
          const d = meta.decodes[f as NicheFile];
          return d ? `${f} (${d.sha === meta.refsSha ? "atualizado" : "VELHO: refaça, as referências mudaram"})` : f;
        }),
      };
    }),
  );
}

export async function readNiche(niche: string, file: string) {
  if (!NICHE_FILES.includes(file as NicheFile)) throw new InputError(`Arquivo de nicho inválido. Use: ${NICHE_FILES.join(", ")}.`);
  const dir = nicheDir(niche);
  const text = await readFile(path.join(dir, file), "utf8").catch(() => null);
  if (text === null) throw new InputError(`O nicho "${slug(niche)}" ainda não tem ${file}.`);
  const meta = await metaOf(dir);
  const d = meta.decodes[file as NicheFile];
  return {
    niche: slug(niche),
    file,
    ref_count: meta.refCount,
    ...(d ? { fresh: d.sha === meta.refsSha, saved_at: d.savedAt } : {}),
    text: text.length > MAX_READ * 2 ? `${text.slice(0, MAX_READ * 2)}\n…(cortado)` : text,
  };
}

// Grava referências (substitui o arquivo inteiro) ou uma análise (marca com a impressão digital atual das referências).
export async function saveNiche(niche: string, file: string, content: string) {
  if (!NICHE_FILES.includes(file as NicheFile)) throw new InputError(`Arquivo de nicho inválido. Use: ${NICHE_FILES.join(", ")}.`);
  if (!content.trim()) throw new InputError("Conteúdo vazio.");
  const dir = nicheDir(niche);
  await mkdir(dir, { recursive: true });
  const meta = await metaOf(dir);
  await writeFile(path.join(dir, file), content);
  if (file === "reference-ads.md") {
    meta.refsSha = sha(content);
    meta.refCount = countRefs(content);
  } else if (DECODES.includes(file as NicheFile)) {
    meta.decodes[file as NicheFile] = { sha: meta.refsSha, savedAt: new Date().toISOString() };
  }
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1));
  return { niche: slug(niche), file, ref_count: meta.refCount };
}

// Acrescenta anúncios campeões ao pool do nicho no formato do método (## Ad NN, parágrafo único, ---), sem duplicar idênticos.
export async function addReferences(niche: string, ads: string[]) {
  const dir = nicheDir(niche);
  const current = await readFile(path.join(dir, "reference-ads.md"), "utf8").catch(() => "");
  const existing = new Set(
    current
      .split(/^---$/m)
      .map((b) => b.replace(/^## Ad.*$/m, "").trim())
      .filter(Boolean),
  );
  let n = countRefs(current);
  let added = 0;
  let body = current.trimEnd();
  for (const raw of ads) {
    const ad = raw.replace(/\s*\n+\s*/g, " ").trim();
    if (!ad || existing.has(ad)) continue;
    existing.add(ad);
    n += 1;
    added += 1;
    body += `${body ? "\n\n" : ""}## Ad ${String(n).padStart(2, "0")}\n\n${ad}\n\n---`;
  }
  if (added) await saveNiche(niche, "reference-ads.md", `${body}\n`);
  const short = ads.filter((a) => a.trim().split(/\s+/).length < 50).length;
  return { niche: slug(niche), added, skipped_duplicates: ads.length - added, ref_count: n, ...(short ? { aviso: `${short} anúncio(s) com menos de 50 palavras` } : {}) };
}

// Sorteio de verdade (o método proíbe "escolher de cabeça"): baralho embaralhado do pool inteiro.
export async function drawReferences(niche: string, count: number) {
  const dir = nicheDir(niche);
  const text = await readFile(path.join(dir, "reference-ads.md"), "utf8").catch(() => "");
  const blocks = text.split(/^(?=## Ad\b)/m).filter((b) => /^## Ad\b/.test(b));
  if (!blocks.length) throw new InputError(`O nicho "${slug(niche)}" não tem referências. Use action=add_refs.`);
  const deck = blocks.map((_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const take = deck.slice(0, Math.min(Math.max(1, count), deck.length));
  return {
    niche: slug(niche),
    ref_count: blocks.length,
    deck: deck.join(","),
    selection_mode: "shell",
    drawn: take.map((n) => ({ position: n, text: blocks[n - 1].replace(/\n?---\s*$/, "").trim() })),
  };
}
