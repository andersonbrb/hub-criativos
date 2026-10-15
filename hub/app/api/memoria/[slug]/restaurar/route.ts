import { restaurar } from "@/features/memoria/servicos/memoria";
import { autorEditor, comConflito, lerCorpo } from "@/features/memoria/servicos/rotas";
import { route } from "@/lib/server/http";

// Restaura uma versão antiga: { versao }. Vira uma versão nova; nada é apagado.
export const POST = route(
  async (request: Request, ctx: RouteContext<"/api/memoria/[slug]/restaurar">) => {
    const { slug } = await ctx.params;
    const autor = await autorEditor();
    const { versao } = await lerCorpo(request);
    return comConflito(async () => Response.json({ documento: await restaurar(slug, Number(versao), autor) }));
  },
  { chave: "memoria_editar" },
);
