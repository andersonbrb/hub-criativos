import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { banco } from "@/db/cliente";
import { route } from "@/lib/server/http";

// Saúde do hub, usada pelo Railway antes de liberar uma versão nova (railway.json → healthcheckPath).
// Pública: não mostra nenhum dado, só se o servidor está de pé e se o banco responde.
// Sem DATABASE_URL (no PC sem banco) o hub funciona com os arquivos locais, então isso não é falha.

// Tempo máximo esperando o banco: o Railway repete a checagem, e uma resposta presa travaria a publicação.
const LIMITE_MS = 5000;

const semCache = { "Cache-Control": "no-store" };

export const GET = route(
  async () => {
    await connection(); // responde a cada pedido, nunca uma resposta guardada do build
    if (!process.env.DATABASE_URL?.trim()) {
      return Response.json({ ok: true, banco: "sem banco" }, { headers: semCache });
    }
    let espera: ReturnType<typeof setTimeout> | undefined;
    try {
      const limite = new Promise<never>((_, falhar) => {
        espera = setTimeout(() => falhar(new Error(`o banco não respondeu em ${LIMITE_MS / 1000} s`)), LIMITE_MS);
      });
      await Promise.race([banco().execute(sql`select 1`), limite]);
      return Response.json({ ok: true, banco: "ok" }, { headers: semCache });
    } catch (err) {
      // O motivo fica só no log do servidor: a rota é pública e não deve expor detalhes do banco.
      console.error("[saude] Banco fora:", err instanceof Error ? err.message : err);
      return Response.json({ ok: false, banco: "fora" }, { status: 503, headers: semCache });
    } finally {
      clearTimeout(espera);
    }
  },
  { publica: true },
);
