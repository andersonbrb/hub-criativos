import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Generation, GenerationTool } from "@/lib/generations";
import { DATA_DIR, esperarFila, naFila, pastaDeDados } from "@/lib/server/pastas";

// Banco local simples em JSON: um db.json por organização (lib/server/pastas.ts). Suficiente para o tamanho das
// equipes; vai para o Postgres na Onda 3 (PLANO-HUB.md).

export { DATA_DIR };

type Db = { generations: Generation[] };

// Caminho do db.json da organização atual, resolvido uma vez por chamada.
export const arquivoDoBanco = async () => path.join(await pastaDeDados(), "db.json");

async function load(arquivo: string): Promise<Db> {
  try {
    return JSON.parse(await readFile(arquivo, "utf8")) as Db;
  } catch {
    return { generations: [] };
  }
}

async function save(arquivo: string, db: Db) {
  await mkdir(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, arquivo);
}

// Serializa as escritas para não perder atualizações concorrentes.
async function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const arquivo = await arquivoDoBanco();
  return naFila(arquivo, async () => {
    const db = await load(arquivo);
    const result = await fn(db);
    await save(arquivo, db);
    return result;
  });
}

async function lerDb(): Promise<Db> {
  const arquivo = await arquivoDoBanco();
  await esperarFila(arquivo);
  return load(arquivo);
}

// Esconde os vídeos apagados ou mandados para a lixeira direto no Drive (`foraDoDrive`, marcado pelo espelho em
// features/drive/servicos/videos.ts). Fica aqui, e não em cada tela, para todas as listas (estúdios, Biblioteca,
// editor, Fluxo, chat e conector) pararem de mostrar o vídeo de uma vez. Só o espelho e a migração pedem tudo.
// getGeneration continua achando: a rota de mídia responde "apagado no Drive" e a lixeira do hub ainda apaga o registro.
export async function listGenerations(tool?: GenerationTool, opcoes: { incluirForaDoDrive?: boolean } = {}): Promise<Generation[]> {
  const db = await lerDb();
  return db.generations
    .filter((g) => (!tool || g.tool === tool) && (opcoes.incluirForaDoDrive || !g.foraDoDrive))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getGeneration(id: string): Promise<Generation | undefined> {
  return (await lerDb()).generations.find((g) => g.id === id);
}

// Criativos finais (edição final, exportação do editor, tradução) entram sozinhos na Biblioteca ao ficarem prontos.
// Só na primeira vez: se você tirar da Biblioteca, `saved` fica false e não volta.
const FINAL_TOOLS: GenerationTool[] = ["montagem", "editor", "heygen-traducao"];
function autoSave(gen: Generation) {
  // Vídeo sem legenda é material de trabalho (ex.: para traduzir), não criativo final.
  if (gen.status === "done" && gen.saved === undefined && FINAL_TOOLS.includes(gen.tool) && gen.params.formato !== "sem-legenda") gen.saved = true;
}

export function createGeneration(data: Omit<Generation, "id" | "createdAt">): Promise<Generation> {
  return withDb((db) => {
    const gen: Generation = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
    autoSave(gen);
    db.generations.push(gen);
    return gen;
  });
}

export function updateGeneration(id: string, patch: Partial<Generation>): Promise<Generation | undefined> {
  return withDb((db) => {
    const gen = db.generations.find((g) => g.id === id);
    if (gen) {
      const wasBusy = gen.status === "pending" || gen.status === "running";
      Object.assign(gen, patch);
      if (wasBusy && (gen.status === "done" || gen.status === "failed")) gen.finishedAt = new Date().toISOString();
      autoSave(gen);
    }
    return gen;
  });
}

export function deleteGeneration(id: string): Promise<boolean> {
  return withDb((db) => {
    const before = db.generations.length;
    db.generations = db.generations.filter((g) => g.id !== id);
    return db.generations.length < before;
  });
}

// "Limpar" de um estúdio: apaga tudo da ferramenta, menos o que está gerando e o que está na Biblioteca.
// `ids`: só estas (a rota manda antes os vídeos do Drive para a lixeira de lá e deixa de fora os que falharam).
export function clearGenerations(tool: GenerationTool, opcoes: { ids?: string[] } = {}): Promise<Generation[]> {
  return withDb((db) => {
    const removable = (g: Generation) =>
      g.tool === tool && !g.saved && (g.status === "done" || g.status === "failed") && (!opcoes.ids || opcoes.ids.includes(g.id));
    const removed = db.generations.filter(removable);
    db.generations = db.generations.filter((g) => !removable(g));
    return removed;
  });
}
