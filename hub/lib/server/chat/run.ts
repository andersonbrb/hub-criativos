import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { ChatEvent } from "@/lib/chat";
import { requireKey } from "@/lib/server/env";
import { hydrateMessages } from "@/lib/server/chat/images";
import { saveChat, type Chat } from "@/lib/server/chat/store";
import { runTool, SERVER_TOOLS, toolDetail, toolsFor } from "@/lib/server/chat/tools";

const MODEL = "claude-opus-5-5";
// Máximo de idas e voltas com ferramentas num único pedido do usuário.
const MAX_STEPS = 40;
// Preço por milhão de tokens do Claude Opus 5.5 (estimativa de custo mostrada na interface).
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2, webSearch: 0.01 };

type Emit = (event: ChatEvent) => void;

function costOf(usage: Anthropic.Beta.BetaUsage): number {
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return (
    (usage.input_tokens * PRICE.input +
      usage.output_tokens * PRICE.output +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
      1_000_000 +
    searches * PRICE.webSearch
  );
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "A chave ANTHROPIC_API_KEY foi recusada. Confira o hub/.env.local.";
  if (err instanceof Anthropic.PermissionDeniedError) return "A chave da Anthropic não tem permissão para esse modelo ou recurso.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de uso da API da Anthropic atingido. Tente de novo em instantes.";
  if (err instanceof Anthropic.APIError) return `API da Anthropic (${err.status ?? "erro"}): ${err.message}`;
  return err instanceof Error ? err.message : "Erro inesperado";
}

// Roda o agente até ele terminar de responder a última mensagem do usuário (já salva em chat.messages).
// Cada passo concluído é salvo; um passo interrompido no meio não entra no histórico.
export async function runChatTurn(chat: Chat, emit: Emit, signal: AbortSignal) {
  const client = new Anthropic({ apiKey: requireKey("anthropic") });

  try {
    for (let step = 0; step < MAX_STEPS && !signal.aborted; step++) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
          // Se o modelo recusar por engano (classificadores de segurança), a API refaz no modelo recomendado.
          fallbacks: "default",
          // "updates": o raciocínio fica oculto, mas as notas de progresso entre ferramentas chegam como texto.
          thinking: { type: "adaptive", display: "updates" },
          output_config: { effort: "medium" },
          cache_control: { type: "ephemeral" },
          system: [{ type: "text", text: chat.system, cache_control: { type: "ephemeral" } }],
          tools: [...toolsFor(chat.toolNames), ...SERVER_TOOLS],
          messages: await hydrateMessages(chat.messages),
        },
        { signal },
      );

      stream.on("text", (delta) => emit({ type: "text", delta }));
      stream.on("thinking", (delta) => {
        if (delta) emit({ type: "status", delta });
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "tool_use" || block.type === "server_tool_use") {
          const detail = toolDetail(block.name, block.input);
          emit({ type: "tool", item: { kind: "tool", id: block.id, name: block.name, detail, done: false, error: false, summary: "", generations: [] } });
        } else if (block.type === "web_search_tool_result") {
          const error = !Array.isArray(block.content);
          const summary = Array.isArray(block.content) ? `${block.content.length} resultados` : `erro: ${block.content.error_code}`;
          chat.toolMeta[block.tool_use_id] = { error, summary, generationIds: [] };
          emit({ type: "tool_done", id: block.tool_use_id, error, summary, generations: [] });
        } else if (block.type === "web_fetch_tool_result") {
          const error = block.content.type !== "web_fetch_result";
          const summary = error ? "não consegui ler" : "página lida";
          chat.toolMeta[block.tool_use_id] = { error, summary, generationIds: [] };
          emit({ type: "tool_done", id: block.tool_use_id, error, summary, generations: [] });
        }
      });

      const message = await stream.finalMessage();
      chat.costUsd = (chat.costUsd ?? 0) + costOf(message.usage);

      if (message.stop_reason === "refusal") {
        await saveChat(chat);
        emit({ type: "error", message: "O Claude recusou esse pedido. Reformule e tente de novo." });
        return;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens" && toolUses.length) {
        await saveChat(chat);
        emit({ type: "error", message: "A resposta passou do limite de tamanho no meio de uma ferramenta. Peça em partes menores." });
        return;
      }

      chat.messages.push({ role: "assistant", content: message.content });

      // pause_turn: a pesquisa na web pausou o turno; reenviar continua de onde parou.
      if (message.stop_reason === "pause_turn") {
        await saveChat(chat);
        continue;
      }
      if (!toolUses.length) {
        await saveChat(chat);
        return;
      }

      const outcomes = await Promise.all(toolUses.map((t) => runTool(t.name, t.input, { signal, chat })));
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((t, i) => {
        const o = outcomes[i];
        const generations = o.generations ?? [];
        chat.toolMeta[t.id] = { error: o.error, summary: o.summary, generationIds: generations.map((g) => g.id) };
        emit({ type: "tool_done", id: t.id, error: o.error, summary: o.summary, generations });
        return { type: "tool_result", tool_use_id: t.id, content: o.content, ...(o.error ? { is_error: true } : {}) };
      });
      // Todos os resultados numa única mensagem, junto com o pedido que os gerou.
      chat.messages.push({ role: "user", content: results });
      await saveChat(chat);
    }
  } catch (err) {
    await saveChat(chat).catch(() => undefined);
    if (err instanceof Anthropic.APIUserAbortError || signal.aborted) return;
    emit({ type: "error", message: friendlyError(err) });
  }
}
