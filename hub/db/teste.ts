import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";

import { usarBanco, type Banco } from "./cliente";
import * as schema from "./schema";

// Postgres de verdade, em memória (PGlite), com todas as tabelas do schema. Cada chamada cria um banco novo e
// vazio e passa a ser o banco() do processo. Uso: `beforeEach(async () => { await bancoDeTeste(); })`.
export async function bancoDeTeste(): Promise<Banco> {
  const db = drizzle(new PGlite(), { schema });
  const { apply } = await pushSchema(schema, db as never);
  await apply();
  usarBanco(db as unknown as Banco);
  return db as unknown as Banco;
}
