import { index, json, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizacoes, usuarios } from "../acesso/tabelas";
import type { CriativoDoSkala } from "./contrato";

// Criativos que chegam do Skala pelo botão "Gerar ganchos" (features/skala). O ciclo de uma linha:
//   1. o servidor do Skala manda o criativo com a chave combinada (POST /api/skala/criativos) e recebe um link;
//   2. a pessoa abre o link (/chat?skala=<token>), entra se precisar, e a tela do chat manda a primeira mensagem;
//   3. a mensagem reserva a entrega (usada_em), baixa o vídeo ou a imagem e a conversa nasce (chat_id).
//
// O TOKEN DO LINK É O SEGREDO: 256 bits, só o SHA-256 no banco, como os links do conector. Uso único e 2 horas.
// O link sozinho não faz nada: abre só para quem entrou no hub e participa da organização da entrega.

export const skalaEntregas = pgTable(
  "skala_entregas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    // O Skala é da Grupo Chegou: a conversa nasce nela (features/skala/contrato.ts).
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacoes.id, { onDelete: "cascade" }),
    // Os criativos como chegaram, já conferidos e cortados nos limites (features/skala/servicos/validar.ts). json, e não
    // jsonb: o jsonb reordena as chaves, e a ordem dos números e das colunas é a que o Skala mostra.
    criativos: json("criativos").$type<CriativoDoSkala[]>().notNull(),
    // O pedido da primeira mensagem ("Me dê ganchos baseados neste criativo").
    pedido: text("pedido").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    usadoPor: uuid("usado_por").references(() => usuarios.id, { onDelete: "set null" }),
    // A conversa do chat principal que nasceu da entrega (reabrir o link leva a ela).
    chatId: text("chat_id"),
    ip: text("ip"),
  },
  (t) => [index("skala_entregas_organizacao_idx").on(t.organizacaoId)],
);
