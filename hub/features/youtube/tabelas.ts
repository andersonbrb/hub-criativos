import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizacoes, usuarios } from "../acesso/tabelas";

// Canal do YouTube de cada organização e os envios de vídeo para ele (features/youtube/servicos).
//
// NENHUM TOKEN EM TEXTO: como no Drive, os tokens do Google ficam cifrados com HUB_CHAVE_SEGREDOS.

// Um canal por organização (a chave é a organização). O mesmo canal não serve a duas organizações (canal único): as
// duas publicariam no mesmo lugar, e desconectar numa cortaria a outra.
export const youtubeConta = pgTable("youtube_conta", {
  organizacaoId: uuid("organizacao_id")
    .primaryKey()
    .references(() => organizacoes.id, { onDelete: "cascade" }),
  canalId: text("canal_id").notNull().unique(),
  canalTitulo: text("canal_titulo").notNull(),
  canalFoto: text("canal_foto"),
  // O @nome do canal, quando ele tem.
  canalEndereco: text("canal_endereco"),
  refreshTokenCifrado: text("refresh_token_cifrado").notNull(),
  accessTokenCifrado: text("access_token_cifrado"),
  expiraEm: timestamp("expira_em", { withTimezone: true }),
  escopos: jsonb("escopos").$type<string[]>().notNull().default([]),
  conectadoPor: uuid("conectado_por").references(() => usuarios.id, { onDelete: "set null" }),
  conectadoEm: timestamp("conectado_em", { withTimezone: true }).notNull().defaultNow(),
});

// Login em andamento (10 minutos, uso único), pelo mesmo motivo do drive_pedidos_login: o verificador do PKCE fica
// cifrado no servidor, e a volta do Google só vale para a mesma pessoa, na mesma organização.
export const youtubePedidosLogin = pgTable("youtube_pedidos_login", {
  state: text("state").primaryKey(),
  verifierCifrado: text("verifier_cifrado").notNull(),
  volta: text("volta").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  iniciadoPor: uuid("iniciado_por").references(() => usuarios.id, { onDelete: "cascade" }),
  organizacaoId: uuid("organizacao_id")
    .notNull()
    .references(() => organizacoes.id, { onDelete: "cascade" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

// Cada pedido de envio de um vídeo pronto (geração do hub) para o canal da organização.
export const youtubeEnvios = pgTable(
  "youtube_envios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    geracaoId: text("geracao_id").notNull(),
    // O `file` da geração quando o envio foi pedido.
    arquivo: text("arquivo").notNull(),
    // Canal conectado quando o envio foi pedido: se a organização trocar de canal, o envio não vai para o novo.
    canalId: text("canal_id").notNull(),
    canalTitulo: text("canal_titulo").notNull(),
    titulo: text("titulo").notNull(),
    descricao: text("descricao").notNull().default(""),
    visibilidade: text("visibilidade").notNull(),
    paraCriancas: boolean("para_criancas").notNull().default(false),
    shorts: boolean("shorts").notNull().default(false),
    // Imagem da miniatura, guardada na pasta da organização até ser aplicada (nome do arquivo).
    miniatura: text("miniatura"),
    agendadoPara: timestamp("agendado_para", { withTimezone: true }),
    situacao: text("situacao").notNull(),
    progresso: integer("progresso"),
    // Endereço da sessão de envio do Google, cifrado: depois de um reinício o envio continua de onde parou, em vez de
    // subir de novo e criar um vídeo repetido no canal.
    sessaoCifrada: text("sessao_cifrada"),
    videoId: text("video_id"),
    erro: text("erro"),
    aviso: text("aviso"),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
  },
  (t) => [index("youtube_envios_organizacao_idx").on(t.organizacaoId, t.criadoEm), index("youtube_envios_fila_idx").on(t.situacao, t.agendadoPara)],
);
