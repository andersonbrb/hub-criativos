import { route } from "@/lib/server/http";
import { getGeneration } from "@/lib/server/store";

// O render roda no próprio servidor e atualiza a geração sozinho; aqui só devolve o estado atual.
export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const generation = await getGeneration((await params).id);
  if (!generation) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
  return Response.json({ generation });
});
