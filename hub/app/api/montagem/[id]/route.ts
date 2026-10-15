import { route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO } from "@/lib/server/media";
import { montageStatus, readLog } from "@/lib/server/montage";
import { getGeneration } from "@/lib/server/store";

// Status + log da montagem (para acompanhar as etapas na tela). Chama: o estúdio de Edição.
export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const gen = await getGeneration(id);
  if (!gen || gen.tool !== "montagem") return Response.json({ error: "Montagem não encontrada." }, { status: 404 });
  return Response.json({ generation: await montageStatus(gen), log: await readLog(id) });
}, { chave: CHAVES_DE_PRODUCAO });
