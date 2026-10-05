import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Generation, GenerationTool } from "@/lib/generations";

// Banco local simples em JSON (hub/.data/db.json). Suficiente para uso local de uma pessoa;
// trocar por SQLite/Postgres quando o hub tiver mais usuários.

export const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");

type Db = { generations: Generation[] };

let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Db> {
  try {
    return JSON.parse(await readFile(DB_FILE, "utf8")) as Db;
  } catch {
    return { generations: [] };
  }
}

async function save(db: Db) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, DB_FILE);
}

// Serializa as escritas para não perder atualizações concorrentes.
function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await save(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function listGenerations(tool?: GenerationTool): Promise<Generation[]> {
  await queue;
  const db = await load();
  return db.generations.filter((g) => !tool || g.tool === tool).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getGeneration(id: string): Promise<Generation | undefined> {
  await queue;
  return (await load()).generations.find((g) => g.id === id);
}

export function createGeneration(data: Omit<Generation, "id" | "createdAt">): Promise<Generation> {
  return withDb((db) => {
    const gen: Generation = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
    db.generations.push(gen);
    return gen;
  });
}

export function updateGeneration(id: string, patch: Partial<Generation>): Promise<Generation | undefined> {
  return withDb((db) => {
    const gen = db.generations.find((g) => g.id === id);
    if (gen) Object.assign(gen, patch);
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
export function clearGenerations(tool: GenerationTool): Promise<Generation[]> {
  return withDb((db) => {
    const removable = (g: Generation) => g.tool === tool && !g.saved && (g.status === "done" || g.status === "failed");
    const removed = db.generations.filter(removable);
    db.generations = db.generations.filter((g) => !removable(g));
    return removed;
  });
}
