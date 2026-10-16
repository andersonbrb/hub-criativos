import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { organizacoes, usuarios } from "../acesso/tabelas";
import { FRENTES, TIPOS } from "./contrato";

// Memória da operação (o antigo contexto do Sávio), uma por organização: o mesmo slug pode existir em duas
// organizações, cada uma com o próprio texto e histórico. O documento guarda a versão atual inteira, para ler e buscar
// sem juntar tabelas; cada gravação que muda o texto vira uma linha em memoria_versoes, que só cresce.

export const memoriaDocumentos = pgTable(
  "memoria_documentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    titulo: text("titulo").notNull(),
    tipo: text("tipo", { enum: TIPOS }).notNull(),
    frente: text("frente", { enum: FRENTES }).notNull().default("geral"),
    mercado: text("mercado"),
    noPrompt: boolean("no_prompt").notNull().default(false),
    precisaRevisao: boolean("precisa_revisao").notNull().default(false),
    metadados: jsonb("metadados").$type<Record<string, unknown>>().notNull().default({}),
    versaoAtual: integer("versao_atual").notNull().default(1),
    conteudoAtual: text("conteudo_atual").notNull(),
    autorAtual: text("autor_atual").notNull(),
    // Título e conteúdo minúsculos e sem acento (features/memoria/texto.ts), título na primeira linha.
    // O Postgres não tem unaccent aqui: a normalização é feita no JavaScript ao gravar.
    busca: text("busca").notNull().default(""),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memoria_documentos_busca_idx").using("gin", sql`to_tsvector('simple', ${t.busca})`),
    index("memoria_documentos_tipo_idx").on(t.organizacaoId, t.tipo, t.slug),
    unique("memoria_documentos_org_slug_unq").on(t.organizacaoId, t.slug),
  ],
);

export const memoriaVersoes = pgTable(
  "memoria_versoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => memoriaDocumentos.id, { onDelete: "cascade" }),
    versao: integer("versao").notNull(),
    conteudo: text("conteudo").notNull(),
    sha256: text("sha256").notNull(),
    // Conta do hub que gravou; null para processos (importador). Se a conta for apagada, fica o nome.
    autorId: uuid("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
    autorNome: text("autor_nome").notNull(),
    nota: text("nota"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("memoria_versoes_doc_versao_unq").on(t.docId, t.versao)],
);
