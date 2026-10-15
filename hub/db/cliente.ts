import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

import * as schema from "./schema";

// Banco Postgres do hub (Railway). As tabelas de cada funcionalidade ficam em features/<nome>/tabelas.ts e são
// reunidas em db/schema.ts. A conexão só abre no primeiro uso: o build do Next roda sem DATABASE_URL.
//
// O tipo é o genérico do Postgres (não o do driver), para os testes trocarem por um Postgres em memória
// (db/teste.ts) sem mudar nenhum serviço.

export type Banco = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as typeof globalThis & { __hubBanco?: Banco };

export function banco(): Banco {
  if (g.__hubBanco) return g.__hubBanco;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Este recurso precisa do banco do hub (DATABASE_URL), que existe só no hub da nuvem. Use o hub da nuvem para isso.");
  // max 10: o Postgres do Railway aceita ~100 conexões e o hub roda num processo só.
  const cliente = postgres(url, { max: 10, idle_timeout: 30 });
  g.__hubBanco = drizzle(cliente, { schema }) as unknown as Banco;
  return g.__hubBanco;
}

// Só para testes: troca o banco do processo (ou volta ao padrão com undefined).
export function usarBanco(novo: Banco | undefined) {
  g.__hubBanco = novo;
}
