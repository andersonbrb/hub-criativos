import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { usuarios } from "../acesso/tabelas";

// Tabelas do Conector do Claude Code: servidor OAuth 2.1 próprio + MCP público (porta do conector do Chegou
// Operações). O ciclo, na ordem em que as linhas nascem:
//   1. oauth_clientes: o Claude se registra sozinho (RFC 7591). É uma instalação do Claude, não uma pessoa.
//   2. oauth_pedidos: /oauth2/authorize validou o pedido e mandou a pessoa para a tela de consentimento (10 min).
//   3. oauth_codigos: a pessoa autorizou. Uso único, 60 segundos.
//   4. conexoes + conexao_tokens: o Claude trocou o código por tokens. É o que a tela "Conector" lista e desconecta.
//   5. chamadas_mcp: cada ferramenta chamada (auditoria).
//   6. conector_links: links curtos de envio e download de arquivo pelo terminal (curl).
//
// NENHUM SEGREDO EM TEXTO: código, tokens e links ficam só como SHA-256 (features/conector/servicos/segredos.ts).
// Quem lê o banco não consegue se passar pelo Claude de ninguém.
//
// A conexão NÃO guarda o que a pessoa pode fazer: as chaves são lidas da conta a cada chamada do Claude. Tirar uma
// chave ou desativar a conta corta o Claude na próxima pergunta, sem esperar o token vencer.

export const oauthClientes = pgTable("oauth_clientes", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Não é segredo (cliente público): quem prova a posse do código é o PKCE.
  clientId: text("client_id").notNull().unique(),
  // O client_name que o próprio cliente mandou no registro.
  nome: text("nome").notNull().default(""),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull().default([]),
  ipRegistro: text("ip_registro"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthPedidos = pgTable(
  "oauth_pedidos",
  {
    // Vai na URL da tela de consentimento. Não autoriza nada sozinho (precisa de sessão logada), mas é longo e
    // aleatório para não ser adivinhado.
    id: text("id").primaryKey(),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => oauthClientes.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    state: text("state").notNull().default(""),
    escopos: jsonb("escopos").$type<string[]>().notNull().default([]),
    resource: text("resource").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    decididoEm: timestamp("decidido_em", { withTimezone: true }),
    decisao: text("decisao", { enum: ["autorizado", "recusado"] }),
    decididoPor: uuid("decidido_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [index("oauth_pedidos_cliente_idx").on(t.clienteId)],
);

export const conexoes = pgTable(
  "conexoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => oauthClientes.id, { onDelete: "cascade" }),
    // claude = Claude no site/app; claude_code = retorno no loopback do computador da pessoa.
    app: text("app", { enum: ["claude", "claude_code"] }).notNull(),
    escopos: jsonb("escopos").$type<string[]>().notNull().default([]),
    // O endereço /mcp para o qual os tokens valem (resource do OAuth).
    audiencia: text("audiencia").notNull(),
    ip: text("ip"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    ultimoUsoEm: timestamp("ultimo_uso_em", { withTimezone: true }),
    // Conexão revogada nunca é apagada: é a trilha de quem conectou e de quem desconectou.
    revogadaEm: timestamp("revogada_em", { withTimezone: true }),
    motivoRevogacao: text("motivo_revogacao"),
    revogadaPor: uuid("revogada_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [index("conexoes_usuario_idx").on(t.usuarioId, t.revogadaEm)],
);

// Fica guardado depois de usado (até um dia depois de vencer): é o que permite reconhecer um código REUSADO e
// revogar a conexão que o primeiro uso criou, em vez de responder só "código inválido".
export const oauthCodigos = pgTable("oauth_codigos", {
  id: uuid("id").primaryKey().defaultRandom(),
  codigoHash: text("codigo_hash").notNull().unique(),
  clienteId: uuid("cliente_id")
    .notNull()
    .references(() => oauthClientes.id, { onDelete: "cascade" }),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource").notNull(),
  escopos: jsonb("escopos").$type<string[]>().notNull().default([]),
  ip: text("ip"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  usadoEm: timestamp("usado_em", { withTimezone: true }),
  conexaoId: uuid("conexao_id").references(() => conexoes.id, { onDelete: "set null" }),
});

// Acesso (1 hora) ou renovação (30 dias). A renovação rotaciona: cada uso devolve um par novo e aposenta o antigo
// (usado_em). O aposentado reapresentado é sinal de cópia e revoga a conexão inteira, por isso ele fica guardado
// até o prazo original.
export const conexaoTokens = pgTable(
  "conexao_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conexaoId: uuid("conexao_id")
      .notNull()
      .references(() => conexoes.id, { onDelete: "cascade" }),
    tipo: text("tipo", { enum: ["acesso", "renovacao"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    revogadoEm: timestamp("revogado_em", { withTimezone: true }),
  },
  (t) => [index("conexao_tokens_conexao_idx").on(t.conexaoId)],
);

// Auditoria de cada ferramenta chamada. Pessoa e conexão viram nulas se forem apagadas: o registro sobrevive.
export const chamadasMcp = pgTable(
  "chamadas_mcp",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    conexaoId: uuid("conexao_id").references(() => conexoes.id, { onDelete: "set null" }),
    ferramenta: text("ferramenta").notNull(),
    // Resumo dos argumentos (textos longos cortados): serve para saber o que foi pedido, não para guardar conteúdo.
    argumentos: text("argumentos").notNull().default(""),
    duracaoMs: integer("duracao_ms").notNull().default(0),
    erro: text("erro"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chamadas_mcp_conexao_idx").on(t.conexaoId, t.criadoEm)],
);

// Links curtos para o terminal: o Claude Code tem o arquivo no disco e um curl, e o MCP tem teto de 1 MB por
// mensagem. Envio: uso único, 15 minutos. Download: 10 minutos, pode repetir.
export const conectorLinks = pgTable("conector_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tipo: text("tipo", { enum: ["envio", "download"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  // Envio: o nome do arquivo que vai chegar (dele saem a extensão e o tipo).
  nomeArquivo: text("nome_arquivo"),
  // Download: a geração do hub (lib/generations.ts) que o link entrega. No envio, a que nasceu do arquivo.
  generationId: text("generation_id"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  usadoEm: timestamp("usado_em", { withTimezone: true }),
});
