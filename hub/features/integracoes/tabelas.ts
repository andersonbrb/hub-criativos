import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { usuarios } from "../acesso/tabelas";

// Chaves das integrações coladas na tela Integrações (features/integracoes/servicos/chaves.ts).
//
// NENHUMA CHAVE EM TEXTO: o valor fica cifrado com AES-256-GCM pela HUB_CHAVE_SEGREDOS, a mesma dos tokens do Drive,
// que existe só nas variáveis do servidor. Quem lê o banco (um backup vazado, por exemplo) não usa as chaves.
export const integracoesChaves = pgTable("integracoes_chaves", {
  // Nome da chave (features/integracoes/contrato.ts).
  nome: text("nome").primaryKey(),
  // null: a chave foi removida na tela. A linha fica para a variável antiga do servidor não voltar sozinha.
  valorCifrado: text("valor_cifrado"),
  atualizadoPor: uuid("atualizado_por").references(() => usuarios.id, { onDelete: "set null" }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});
