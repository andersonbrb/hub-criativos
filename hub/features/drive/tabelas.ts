import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizacoes, usuarios } from "../acesso/tabelas";

// Conta Google onde os vídeos de cada organização moram (features/drive/servicos/conta.ts).
//
// NENHUM TOKEN EM TEXTO: os tokens do Google ficam cifrados com AES-256-GCM pela chave HUB_CHAVE_SEGREDOS, que existe
// só nas variáveis do servidor. Quem lê o banco (um backup vazado, por exemplo) não consegue abrir o Drive.

// Uma conta por organização: a chave é a organização, então conectar outra conta substitui a linha em vez de criar uma
// segunda (o banco garante, não só o código). A mesma conta Google não serve a duas organizações (e-mail único): as
// duas veriam a mesma pasta "Hub de Criativos", e desconectar numa cortaria a outra.
export const driveConta = pgTable("drive_conta", {
  organizacaoId: uuid("organizacao_id")
    .primaryKey()
    .references(() => organizacoes.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  nome: text("nome"),
  // A autorização permanente: com ela o hub pede tokens de acesso novos sem a pessoa entrar de novo.
  refreshTokenCifrado: text("refresh_token_cifrado").notNull(),
  // O token de acesso vale ~1 hora. Guardado para não pedir um novo ao Google a cada reinício do servidor.
  accessTokenCifrado: text("access_token_cifrado"),
  expiraEm: timestamp("expira_em", { withTimezone: true }),
  // O que a pessoa liberou de fato na tela do Google (ela pode desmarcar o Drive).
  escopos: jsonb("escopos").$type<string[]>().notNull().default([]),
  conectadoPor: uuid("conectado_por").references(() => usuarios.id, { onDelete: "set null" }),
  conectadoEm: timestamp("conectado_em", { withTimezone: true }).notNull().defaultNow(),
  // Pasta escolhida na janela do Google (tela Integrações) para guardar a "Hub de Criativos". Vazia: a raiz do Meu
  // Drive. pastaDriveId: o Drive compartilhado onde ela fica (vazio no Meu Drive).
  pastaId: text("pasta_id"),
  pastaNome: text("pasta_nome"),
  pastaDriveId: text("pasta_drive_id"),
});

// Login em andamento: o que o hub precisa lembrar entre mandar a pessoa ao Google e ela voltar (10 minutos, uso
// único). Fica no banco, e não num cookie, porque o pedido amarra o que o navegador não deve poder trocar: o
// verificador do PKCE (segredo, cifrado), o endereço de volta já conferido, quem começou o login e em qual
// organização. Na volta, o pedido só vale para a mesma pessoa, na mesma organização: um link de retorno do Google
// aberto por outra conta do hub é recusado (sem isso, alguém poderia fazer o admin conectar, sem perceber, o Drive de
// outra pessoa).
export const drivePedidosLogin = pgTable("drive_pedidos_login", {
  // O "state" do OAuth: aleatório, vai ao Google e volta na URL.
  state: text("state").primaryKey(),
  verifierCifrado: text("verifier_cifrado").notNull(),
  // Caminho do hub para onde a pessoa volta (já passou por caminhoSeguro).
  volta: text("volta").notNull(),
  // O mesmo redirect_uri tem de ir na troca do código; guardado para não depender de a origem bater de novo.
  redirectUri: text("redirect_uri").notNull(),
  iniciadoPor: uuid("iniciado_por").references(() => usuarios.id, { onDelete: "cascade" }),
  // Organização onde o Drive vai ser conectado (a aberta quando o login começou).
  organizacaoId: uuid("organizacao_id")
    .notNull()
    .references(() => organizacoes.id, { onDelete: "cascade" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});
