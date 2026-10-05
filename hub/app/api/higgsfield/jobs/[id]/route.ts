import { refreshGeneration } from "@/lib/server/actions";
import { route } from "@/lib/server/http";
import { getGeneration } from "@/lib/server/store";

// Atualiza o status de uma geração; quando termina, baixa o resultado para o hub.
export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const gen = await getGeneration(id);
  if (!gen?.jobId) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
  return Response.json({ generation: await refreshGeneration(gen) });
});
