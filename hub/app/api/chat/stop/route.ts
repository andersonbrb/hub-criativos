import { stopTurn } from "@/lib/server/chat/running";
import { getChat } from "@/lib/server/chat/store";
import { route } from "@/lib/server/http";

// Botão Parar: encerra o turno em andamento da conversa (Claude Code, Venice ou API). JSON: { chatId }
export const POST = route(async (request: Request) => {
  const { chatId } = (await request.json().catch(() => ({}))) as { chatId?: string };
  // Só para a conversa desta organização (os turnos em andamento ficam numa lista do processo, de todas).
  const chat = chatId ? await getChat(String(chatId)) : null;
  return Response.json({ stopped: chat ? stopTurn(chat.id) : false });
}, { chave: ["chat", "criativo-automatico"] });
