import type { EntradaSalvar } from "@/features/memoria/contrato";
import { ler, salvar } from "@/features/memoria/servicos/memoria";
import { autorEditor, comConflito, lerCorpo } from "@/features/memoria/servicos/rotas";
import { route } from "@/lib/server/http";

// Lê um documento: GET ?versao= (sem versão, a mais recente).
export const GET = route(
  async (request: Request, ctx: RouteContext<"/api/memoria/[slug]">) => {
    const { slug } = await ctx.params;
    const versao = new URL(request.url).searchParams.get("versao");
    const doc = await ler(slug, versao ? Number(versao) : undefined);
    if (!doc) return Response.json({ error: versao ? `Não achei a versão ${versao} de "${slug}".` : `Não existe documento "${slug}" na Memória.` }, { status: 404 });
    return Response.json({ documento: doc });
  },
  { chave: "memoria" },
);

// Salva: { conteudo, versaoEsperada (a versão que a pessoa leu), titulo?, tipo?, frente?, mercado?, noPrompt?, nota? }.
// Se o documento mudou desde a leitura: 409 com a versão atual.
export const PUT = route(
  async (request: Request, ctx: RouteContext<"/api/memoria/[slug]">) => {
    const { slug } = await ctx.params;
    const autor = await autorEditor();
    const corpo = await lerCorpo(request);
    return comConflito(async () => Response.json({ documento: await salvar({ ...corpo, slug } as EntradaSalvar, autor) }));
  },
  { chave: "memoria_editar" },
);
