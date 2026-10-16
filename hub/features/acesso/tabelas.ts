import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

// Contas, organizações, equipes, sessões do site e convites. E-mail sempre gravado em minúsculas.
// Senha: scrypt do Node (features/acesso/servicos). Tokens (sessão e convite) só como SHA-256: o valor puro
// existe apenas no cookie ou no link enviado à pessoa.
//
// Uma conta pode participar de várias organizações. O papel e as telas liberadas são de cada organização
// (organizacao_membros), não da conta: a mesma pessoa pode ser dona de uma e membro de outra.

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  nome: text("nome").notNull(),
  // null enquanto a pessoa não definiu a senha.
  senhaHash: text("senha_hash"),
  // Quem opera a plataforma: cria organizações e suspende. Só vem do script criar-dono (nenhuma tela dá).
  operaPlataforma: boolean("opera_plataforma").notNull().default(false),
  // Organização aberta por último: é onde a pessoa cai ao entrar de novo.
  // (O tipo explícito resolve a referência circular entre contas e organizações.)
  ultimaOrganizacaoId: uuid("ultima_organizacao_id").references((): AnyPgColumn => organizacoes.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  ultimoAcessoEm: timestamp("ultimo_acesso_em", { withTimezone: true }),
});

export const organizacoes = pgTable("organizacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  // Suspensa: a equipe perde o acesso às telas até a plataforma reativar. Os dados continuam guardados.
  situacao: text("situacao", { enum: ["ativa", "suspensa"] }).notNull().default("ativa"),
  criadoPor: uuid("criado_por").references((): AnyPgColumn => usuarios.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const organizacaoMembros = pgTable(
  "organizacao_membros",
  {
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    papel: text("papel", { enum: ["dono", "admin", "membro"] }).notNull().default("membro"),
    // Chaves das telas liberadas nesta organização (catálogo em features/acesso/contrato.ts). Dono e admin veem tudo.
    chaves: jsonb("chaves").$type<string[]>().notNull().default([]),
    // Desativado: continua na lista da equipe (histórico), mas não abre nada desta organização.
    ativo: boolean("ativo").notNull().default(true),
    entrouEm: timestamp("entrou_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizacaoId, t.usuarioId] }), index("organizacao_membros_usuario_idx").on(t.usuarioId)],
);

export const sessoes = pgTable(
  "sessoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    // Organização aberta nesta sessão. null: a pessoa não participa de nenhuma organização ativa.
    organizacaoId: uuid("organizacao_id").references(() => organizacoes.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull().unique(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    ultimoUsoEm: timestamp("ultimo_uso_em", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    navegador: text("navegador"),
  },
  (t) => [index("sessoes_usuario_idx").on(t.usuarioId)],
);

export const convites = pgTable(
  "convites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Organização para a qual a pessoa é convidada.
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    nome: text("nome"),
    papel: text("papel", { enum: ["dono", "admin", "membro"] }).notNull().default("membro"),
    chaves: jsonb("chaves").$type<string[]>().notNull().default([]),
    tokenHash: text("token_hash").notNull().unique(),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
  },
  (t) => [index("convites_organizacao_idx").on(t.organizacaoId)],
);
