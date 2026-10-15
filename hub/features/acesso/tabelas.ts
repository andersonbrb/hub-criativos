import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Contas, sessões do site e convites. E-mail sempre gravado em minúsculas.
// Senha: scrypt do Node (features/acesso/servicos). Tokens (sessão e convite) só como SHA-256: o valor puro
// existe apenas no cookie ou no link enviado à pessoa.

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  nome: text("nome").notNull(),
  // null enquanto a pessoa não definiu a senha (conta criada por convite ainda não aceito).
  senhaHash: text("senha_hash"),
  papel: text("papel", { enum: ["dono", "admin", "membro"] }).notNull().default("membro"),
  ativo: boolean("ativo").notNull().default(true),
  // Chaves das telas liberadas (catálogo em features/acesso/contrato.ts). Dono e admin veem tudo.
  chaves: jsonb("chaves").$type<string[]>().notNull().default([]),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  ultimoAcessoEm: timestamp("ultimo_acesso_em", { withTimezone: true }),
});

export const sessoes = pgTable(
  "sessoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    ultimoUsoEm: timestamp("ultimo_uso_em", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    navegador: text("navegador"),
  },
  (t) => [index("sessoes_usuario_idx").on(t.usuarioId)],
);

export const convites = pgTable("convites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  nome: text("nome"),
  papel: text("papel", { enum: ["admin", "membro"] }).notNull().default("membro"),
  chaves: jsonb("chaves").$type<string[]>().notNull().default([]),
  tokenHash: text("token_hash").notNull().unique(),
  criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  usadoEm: timestamp("usado_em", { withTimezone: true }),
});
