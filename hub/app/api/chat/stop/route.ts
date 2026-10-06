import { stopTurn } from "@/lib/server/chat/running";
import { route } from "@/lib/server/http";

// Botão Parar: encerra o turno em andamento da conversa (Claude Code, Venice ou API). JSON: { chatId }
export const POST = route(async (request: Request) => {
  const { chatId } = (await request.json().catch(() => ({}))) as { chatId?: string };
  return Response.json({ stopped: chatId ? stopTurn(String(chatId)) : false });
});
