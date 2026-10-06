import { getAgentProfile } from "@/lib/agent-profiles";
import { buildSystemPrompt } from "@/lib/server/chat/system";
import { deleteChat, listFullChats, newChat, saveChat, summary } from "@/lib/server/chat/store";
import { TOOL_NAMES } from "@/lib/server/chat/tools";
import { route } from "@/lib/server/http";

// Botão "Nova conversa": cria a conversa na hora (vazia, com o prompt do agente congelado agora),
// para ela já aparecer selecionada na lista. O título vem da primeira mensagem. JSON: { agentId? }
export const POST = route(async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as { agentId?: string };
  const agentId = getAgentProfile(body.agentId ?? "")?.id;
  // Não acumula "Nova conversa" em branco: apaga as vazias do mesmo agente (ou do chat principal) antes.
  const empties = (await listFullChats()).filter((c) => c.messages.length === 0 && (c.agentId ?? null) === (agentId ?? null));
  await Promise.all(empties.map((c) => deleteChat(c.id)));
  const chat = newChat("Nova conversa", await buildSystemPrompt(agentId), TOOL_NAMES, agentId);
  await saveChat(chat);
  return Response.json({ chat: summary(chat) });
});
