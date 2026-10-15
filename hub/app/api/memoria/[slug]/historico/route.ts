import { historico } from "@/features/memoria/servicos/memoria";
import { route } from "@/lib/server/http";

// Versões do documento, da mais nova para a mais antiga.
export const GET = route(
  async (_request: Request, ctx: RouteContext<"/api/memoria/[slug]/historico">) => {
    const { slug } = await ctx.params;
    return Response.json({ versoes: await historico(slug) });
  },
  { chave: "memoria" },
);
