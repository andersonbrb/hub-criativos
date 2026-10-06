import "server-only";

import { randomUUID } from "node:crypto";

import type { Generation } from "@/lib/generations";
import { getChat, newChat, saveChat } from "@/lib/server/chat/store";
import { setActivityChat, type PersonView } from "@/lib/server/mcp-access";

// O que o Claude Code/Codex de uma pessoa conectada ("Conectar com a IA") faz no hub aparece numa conversa
// "Claude Code · Nome" do chat principal, com os cards das mídias (player, Visualizar, Editor), como no chat do hub.
// Consultas sem efeito (listar, ler, orçar, acompanhar) não entram, para a conversa mostrar só o que foi feito.

const READ_ONLY = new Set([
  "hub_list_generations",
  "hub_check_generations",
  "hub_view_image",
  "hub_view_video",
  "hub_contact_sheet",
  "hub_list_chats",
  "hub_read_chat",
  "elevenlabs_list_voices",
  "heygen_list_avatars",
  "heygen_list_voices",
  "flora_list_models",
  "flora_quote",
  "higgsfield_list_edits",
  "pipeline_get",
]);
const AD_WRITER_READS = new Set(["files", "read", "search", "niches", "niche_read", "draw"]);

const queues = new Map<string, Promise<unknown>>();

// Corta textos longos do pedido (ex.: conteúdo salvo) para a conversa não pesar.
const trim = (v: unknown): unknown =>
  typeof v === "string" ? (v.length > 1500 ? `${v.slice(0, 1500)}…` : v) : Array.isArray(v) ? v.slice(0, 30).map(trim) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)])) : v;

export function logActivity(
  person: PersonView,
  tool: string,
  input: Record<string, unknown>,
  outcome: { summary: string; error: boolean; generations?: Generation[] },
) {
  const gens = outcome.generations ?? [];
  if (!gens.length && (READ_ONLY.has(tool) || (tool === "ad_writer" && AD_WRITER_READS.has(String(input.action))))) return Promise.resolve();
  // Uma fila por pessoa: chamadas em paralelo não sobrescrevem a conversa uma da outra.
  const next = (queues.get(person.id) ?? Promise.resolve())
    .then(async () => {
      let chat = person.chatId ? await getChat(person.chatId) : null;
      if (!chat) {
        chat = newChat(`Claude Code · ${person.name}`, "");
        person.chatId = chat.id;
        await setActivityChat(person.id, chat.id);
      }
      const id = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      chat.messages.push(
        { role: "assistant", content: [{ type: "tool_use", id, name: tool, input: trim(input) as Record<string, unknown> }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: outcome.summary || "ok", ...(outcome.error ? { is_error: true } : {}) }] },
      );
      chat.toolMeta[id] = { error: outcome.error, summary: outcome.summary, generationIds: gens.map((g) => g.id) };
      await saveChat(chat);
    })
    .catch(() => undefined);
  queues.set(person.id, next);
  return next;
}
