import { sql } from "drizzle-orm";
import { bigserial, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizacoes } from "../acesso/tabelas";

// Instagram (features/instagram, o antigo "San Benito Social"): o núcleo grava cada agregado (mercado, conta, post de
// referência, peça, revisão, publicação) como um documento versionado, como fazia no projeto de origem, agora com a
// organização dona. `tipo` separa os agregados (ex.: "studio.content_piece"); `dados` é o retrato do agregado.
// O índice GIN atende os filtros por igualdade (`dados @> {...}`) dos repositórios.
export const instagramDocumentos = pgTable(
  "instagram_documentos",
  {
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull(),
    id: text("id").notNull(),
    versao: integer("versao").notNull(),
    dados: jsonb("dados").$type<Record<string, unknown>>().notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizacaoId, t.tipo, t.id] }),
    index("instagram_documentos_dados_gin").using("gin", sql`${t.dados} jsonb_path_ops`),
  ],
);

// Todo evento do núcleo (post selecionado, peça produzida, aprovada, publicada...): histórico e feed da tela Início.
export const instagramEventos = pgTable(
  "instagram_eventos",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull(),
    ocorreuEm: timestamp("ocorreu_em", { withTimezone: true }).notNull(),
    dados: jsonb("dados").$type<unknown>().notNull(),
  },
  (t) => [index("instagram_eventos_organizacao_idx").on(t.organizacaoId, t.ocorreuEm)],
);
