import "server-only";

// Turnos de chat em andamento, por conversa: o botão Parar chama /api/chat/stop, que aborta aqui.
// (Só cancelar o fetch no navegador não basta: o request.signal do Next nem sempre dispara quando a conexão cai.)

const g = globalThis as typeof globalThis & { __hubRunningChats?: Map<string, AbortController> };
const running = (g.__hubRunningChats ??= new Map());

export function startTurn(chatId: string): AbortController {
  running.get(chatId)?.abort(); // um turno novo encerra o anterior da mesma conversa
  const controller = new AbortController();
  running.set(chatId, controller);
  return controller;
}

export function endTurn(chatId: string, controller: AbortController) {
  if (running.get(chatId) === controller) running.delete(chatId);
}

export function stopTurn(chatId: string): boolean {
  const controller = running.get(chatId);
  if (!controller) return false;
  controller.abort();
  running.delete(chatId);
  return true;
}

// Sinal do turno em andamento (para as ferramentas chamadas pela MCP pararem junto).
export const turnSignal = (chatId: string): AbortSignal | undefined => running.get(chatId)?.signal;
