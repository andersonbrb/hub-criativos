import { mediaUrlOf } from "@/lib/server/agent-config-view";
import { removeAgentFile } from "@/lib/server/agent-settings";
import { route } from "@/lib/server/http";

// Tira um arquivo de referência do agente (e apaga a mídia).
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
  const { id, fileId } = await params;
  return Response.json({ settings: mediaUrlOf(await removeAgentFile(id, fileId)) });
});
