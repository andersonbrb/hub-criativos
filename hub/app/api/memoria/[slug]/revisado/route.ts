import { marcarRevisado } from "@/features/memoria/servicos/memoria";
import { autorEditor } from "@/features/memoria/servicos/rotas";
import { route } from "@/lib/server/http";

// Tira o documento da fila de revisão.
export const POST = route(
  async (_request: Request, ctx: RouteContext<"/api/memoria/[slug]/revisado">) => {
    const { slug } = await ctx.params;
    return Response.json({ documento: await marcarRevisado(slug, await autorEditor()) });
  },
  { chave: "memoria_editar" },
);
