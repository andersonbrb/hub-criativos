import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { quemChama } from "@/features/api/servicos/quem-chama";
import { json, SEM_CACHE } from "@/features/conector/servicos/http";
import { route } from "@/lib/server/http";

// "Conferir a chave" da API do hub: o outro sistema (o Skala, na tela de Integrações dele) testa a chave colada antes
// de usar. Aberta sem login, protegida pela própria chave. Não muda nada (só marca o último uso da chave).
export const GET = route(
  async (request: Request) => {
    if (modoLocalSemBanco()) return json({ error: "A API do hub só funciona no hub da nuvem." }, 503, SEM_CACHE);
    const chamador = await quemChama(request);
    if (!chamador) return json({ error: "Chave de API inválida ou revogada." }, 401, SEM_CACHE);
    return json({ ok: true, organizacao: chamador.organizacao, chave: chamador.nomeDaChave }, 200, SEM_CACHE);
  },
  { publica: true },
);
