import { buscar } from "@/features/memoria/servicos/memoria";
import { filtroDaUrl } from "@/features/memoria/servicos/rotas";
import { route } from "@/lib/server/http";

// Busca na Memória: GET ?q=&tipo=&frente=&limite= (padrão 10, máximo 30). Cada resultado traz um trecho.
export const GET = route(
  async (request: Request) => {
    const p = new URL(request.url).searchParams;
    const limite = Number(p.get("limite")) || undefined;
    return Response.json({ resultados: await buscar(p.get("q") ?? "", { ...filtroDaUrl(p), limite }) });
  },
  { chave: "memoria" },
);
