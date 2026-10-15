import "server-only";

import { and, eq, gte, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { conectorLinks, conexaoTokens, conexoes, oauthClientes, oauthCodigos, oauthPedidos } from "@/db/schema";
import { INATIVIDADE_MAXIMA_MS } from "@/features/conector/servicos/config";

// Limpeza preguiçosa: o que venceu sai no caminho (no register e no authorize), no máximo a cada 10 minutos, sem
// cron. O volume é pequeno, e um serviço agendado a mais seria mais uma coisa para lembrar que existe.
//
// O QUE FICA DE PROPÓSITO:
//   • código usado: um dia depois de vencer. É o que permite reconhecer um código REUSADO e revogar a conexão.
//   • token de renovação usado: até o prazo original (30 dias), pelo mesmo motivo.
//   • pedido já decidido: 30 dias (diz quem autorizou ou recusou, e quando).
//   • cliente registrado sem conexão: 30 dias. O Claude guarda o client_id e reaproveita no próximo "Conectar";
//     apagar cedo faria a pessoa bater em "cliente desconhecido" sem ter feito nada de errado.
//   • conexão revogada: nunca sai. É a trilha de quem conectou e de quem desconectou.

const INTERVALO_MS = 10 * 60_000;
const DIA_MS = 24 * 60 * 60_000;

let ultima = 0;

export async function limparVencidos(forcar = false): Promise<void> {
  const agora = Date.now();
  if (!forcar && agora - ultima < INTERVALO_MS) return;
  ultima = agora;
  const db = banco();
  const ja = new Date(agora);
  const umDia = new Date(agora - DIA_MS);
  const trintaDias = new Date(agora - 30 * DIA_MS);

  await db.delete(oauthPedidos).where(and(lt(oauthPedidos.expiraEm, ja), isNull(oauthPedidos.decididoEm)));
  await db.delete(oauthPedidos).where(lt(oauthPedidos.expiraEm, trintaDias));
  await db.delete(oauthCodigos).where(lt(oauthCodigos.expiraEm, umDia));
  await db.delete(conexaoTokens).where(lt(conexaoTokens.expiraEm, umDia));
  await db.delete(conectorLinks).where(lt(conectorLinks.expiraEm, umDia));
  await db.delete(oauthClientes).where(
    and(
      lt(oauthClientes.criadoEm, trintaDias),
      notExists(db.select({ x: sql`1` }).from(conexoes).where(eq(conexoes.clienteId, oauthClientes.id))),
      notExists(
        db
          .select({ x: sql`1` })
          .from(oauthPedidos)
          .where(and(eq(oauthPedidos.clienteId, oauthClientes.id), gte(oauthPedidos.expiraEm, ja))),
      ),
    ),
  );
  // Conexão parada há 60 dias expira (a conferência a cada chamada já recusa; aqui ela some da lista também).
  const limite = new Date(agora - INATIVIDADE_MAXIMA_MS);
  await db
    .update(conexoes)
    .set({ revogadaEm: ja, motivoRevogacao: "inatividade" })
    .where(
      and(
        isNull(conexoes.revogadaEm),
        or(and(isNotNull(conexoes.ultimoUsoEm), lt(conexoes.ultimoUsoEm, limite)), and(isNull(conexoes.ultimoUsoEm), lt(conexoes.criadoEm, limite))),
      ),
    );
}

// Só para testes: a próxima chamada roda de novo.
export function zerarLimpeza() {
  ultima = 0;
}
