import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizacoes, usuarios } from "../acesso/tabelas";

// Chaves de API do hub (features/api): outro sistema (o Skala) chama a API do hub com uma delas.
// NENHUM SEGREDO EM TEXTO: a chave fica só como SHA-256 (token_hash). Revogar não apaga a linha: a lista continua
// mostrando quem criou, quando foi usada pela última vez e quando foi revogada.
export const chavesApi = pgTable(
  "chaves_api",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // O que a chave manda entra nesta organização.
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    // O começo da chave (hub_api_ e mais 4 letras), para reconhecer na lista. Não serve para entrar.
    comeco: text("comeco").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    criadaPor: uuid("criada_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    ultimoUsoEm: timestamp("ultimo_uso_em", { withTimezone: true }),
    revogadaEm: timestamp("revogada_em", { withTimezone: true }),
    revogadaPor: uuid("revogada_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [index("chaves_api_organizacao_idx").on(t.organizacaoId)],
);
