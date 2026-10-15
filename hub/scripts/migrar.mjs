// Aplica as migrações pendentes do banco (db/migrations). Roda antes do servidor subir no Railway (Dockerfile).
// Sem DATABASE_URL (ex.: no PC sem banco) não faz nada.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL?.trim();
const pasta = fileURLToPath(new URL("../db/migrations", import.meta.url));

if (!url) {
  console.log("[migrar] Sem DATABASE_URL: nada a migrar.");
} else if (!existsSync(`${pasta}/meta/_journal.json`)) {
  console.log("[migrar] Nenhuma migração gerada ainda.");
} else {
  const cliente = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(cliente), { migrationsFolder: pasta });
    console.log("[migrar] Banco em dia.");
  } finally {
    await cliente.end();
  }
}
