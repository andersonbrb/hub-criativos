import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";

import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";

import { usarBanco, type Banco } from "./cliente";
import * as schema from "./schema";

// Postgres de verdade, em memória (PGlite), com todas as tabelas do schema. Cada chamada cria um banco novo e
// vazio e passa a ser o banco() do processo. Uso: `beforeEach(async () => { await bancoDeTeste(); })`.
// Como o banco de verdade depois das migrações, já vem com a organização padrão (Grupo Chegou), dona de tudo o que
// não diz de quem é.
export async function bancoDeTeste(): Promise<Banco> {
  const db = drizzle(new PGlite(), { schema });
  const { apply } = await pushSchema(schema, db as never);
  await apply();
  await db.insert(schema.organizacoes).values({ id: ORGANIZACAO_PADRAO.id, nome: ORGANIZACAO_PADRAO.nome });
  usarBanco(db as unknown as Banco);
  return db as unknown as Banco;
}
