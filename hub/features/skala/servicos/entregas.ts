import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { skalaEntregas } from "@/db/schema";
import { hashDe, novo } from "@/features/conector/servicos/segredos";
import { ORGANIZACAO_DO_SKALA, PREFIXO_DO_LINK, VALIDADE_DO_LINK_MS, type EntregaDoSkala } from "@/features/skala/contrato";

// As entregas do Skala (features/skala/tabelas.ts): guardar o que chegou, dizer em que pé está o link e reservar na
// hora em que a conversa começa. O token em texto só existe na resposta ao Skala; no banco fica o SHA-256.

export type Entrega = typeof skalaEntregas.$inferSelect;

const tokenComFormato = (token: unknown): token is string => typeof token === "string" && token.startsWith(PREFIXO_DO_LINK) && token.length <= 200;

// organizacaoId: a de quem mandou (a da chave de API; com a chave fixa do Skala, a Grupo Chegou).
export async function registrarEntrega(
  entrega: EntregaDoSkala,
  ip: string | null,
  organizacaoId: string = ORGANIZACAO_DO_SKALA,
  chaveApiId: string | null = null,
  agora = new Date(),
) {
  const token = novo(PREFIXO_DO_LINK);
  const expiraEm = new Date(agora.getTime() + VALIDADE_DO_LINK_MS);
  await banco()
    .insert(skalaEntregas)
    .values({ tokenHash: hashDe(token), organizacaoId, criativos: entrega.criativos, pedido: entrega.pedido, expiraEm, ip, chaveApiId });
  return { token, expiraEm };
}

// Em que pé está o link (a tela do chat decide o que mostrar):
//   pendente: ninguém abriu ainda, dentro do prazo;
//   usada: já virou conversa (ou está virando agora: chatId ainda vazio);
//   invalida: não existe ou venceu sem ser usada.
export type Situacao =
  | { estado: "pendente"; entrega: Entrega }
  | { estado: "usada"; entrega: Entrega }
  | { estado: "invalida" };

export async function situacaoDaEntrega(token: unknown, agora = new Date()): Promise<Situacao> {
  if (!tokenComFormato(token)) return { estado: "invalida" };
  const [linha] = await banco().select().from(skalaEntregas).where(eq(skalaEntregas.tokenHash, hashDe(token))).limit(1);
  if (!linha) return { estado: "invalida" };
  if (linha.usadoEm) return { estado: "usada", entrega: linha };
  if (linha.expiraEm.getTime() <= agora.getTime()) return { estado: "invalida" };
  return { estado: "pendente", entrega: linha };
}

// Reserva para a primeira mensagem: uma vez só, mesmo com duas abas ao mesmo tempo. null = já usada ou vencida.
export async function reservarEntrega(token: unknown, usuarioId: string, organizacaoId: string, agora = new Date()): Promise<Entrega | null> {
  if (!tokenComFormato(token)) return null;
  const [linha] = await banco()
    .update(skalaEntregas)
    .set({ usadoEm: agora, usadoPor: usuarioId })
    .where(
      and(
        eq(skalaEntregas.tokenHash, hashDe(token)),
        eq(skalaEntregas.organizacaoId, organizacaoId),
        isNull(skalaEntregas.usadoEm),
        gt(skalaEntregas.expiraEm, agora),
      ),
    )
    .returning();
  return linha ?? null;
}

// A conversa não chegou a nascer (erro antes de gravar): o link volta a valer, dentro do mesmo prazo.
export async function devolverEntrega(id: string) {
  await banco().update(skalaEntregas).set({ usadoEm: null, usadoPor: null }).where(and(eq(skalaEntregas.id, id), isNull(skalaEntregas.chatId)));
}

export async function concluirEntrega(id: string, chatId: string) {
  await banco().update(skalaEntregas).set({ chatId }).where(eq(skalaEntregas.id, id));
}
