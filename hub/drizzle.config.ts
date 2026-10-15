import { defineConfig } from "drizzle-kit";

// npm run db:gerar → cria a migração SQL em db/migrations a partir de db/schema.ts (não precisa de banco).
// npm run db:migrar → aplica as migrações pendentes (scripts/migrar.mjs; roda sozinho ao subir no Railway).
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
