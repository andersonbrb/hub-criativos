import "server-only";

import type { ChatItem } from "@/lib/chat";
import type { Generation } from "@/lib/generations";
import type { Chat } from "@/lib/server/chat/store";
import { toolDetail } from "@/lib/server/chat/tools";
import { getGeneration } from "@/lib/server/store";

// Converte o histórico salvo (formato da API) nos itens que a interface desenha.

export const ATTACHMENTS_NOTE = "\n\n[Anexos: ";

export async function toItems(chat: Chat): Promise<ChatItem[]> {
  const items: ChatItem[] = [];
  const gens = new Map<string, Generation>();
  const ids = new Set(Object.values(chat.toolMeta).flatMap((m) => m.generationIds));
  await Promise.all(
    [...ids].map(async (id) => {
      const g = await getGeneration(id);
      if (g) gens.set(id, g);
    }),
  );

  const push = (kind: "assistant" | "status", text: string) => {
    const last = items.at(-1);
    if (last?.kind === kind) last.text += text;
    else items.push({ kind, text });
  };

  for (const [index, m] of chat.messages.entries()) {
    if (typeof m.content === "string") {
      if (m.role === "user") items.push({ kind: "user", text: m.content, attachments: chat.attachments?.[index] ?? [] });
      else push("assistant", m.content);
      continue;
    }
    if (m.role === "user") {
      if (m.content.every((b) => b.type === "tool_result")) continue;
      // O texto digitado é o último bloco de texto; os anteriores são arquivos de texto anexados.
      const texts = m.content.filter((b) => b.type === "text");
      const text = texts.at(-1)?.type === "text" ? texts.at(-1)!.text : "";
      const cut = text.indexOf(ATTACHMENTS_NOTE);
      items.push({ kind: "user", text: cut >= 0 ? text.slice(0, cut) : text, attachments: chat.attachments?.[index] ?? [] });
      continue;
    }
    for (const b of m.content) {
      if (b.type === "text") push("assistant", b.text);
      else if (b.type === "thinking" && b.thinking) push("status", b.thinking);
      else if (b.type === "tool_use" || b.type === "server_tool_use") {
        const meta = chat.toolMeta[b.id];
        items.push({
          kind: "tool",
          id: b.id,
          name: b.name,
          detail: toolDetail(b.name, b.input),
          done: true,
          error: meta ? meta.error : true,
          summary: meta?.summary ?? "interrompido",
          generations: (meta?.generationIds ?? []).map((id) => gens.get(id)).filter((g): g is Generation => Boolean(g)),
        });
      }
    }
  }
  return items;
}
