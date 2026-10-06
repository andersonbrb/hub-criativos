import "server-only";

import { randomUUID } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";

import type { ChatEvent } from "@/lib/chat";
import { requireKey } from "@/lib/server/env";
import { hydrateMessages } from "@/lib/server/chat/images";
import { saveChat, type Chat } from "@/lib/server/chat/store";
import { runTool, toolDetail, toolsFor } from "@/lib/server/chat/tools";

// "Modo Black": o mesmo agente do chat (mesmo prompt de sistema, mesmas ferramentas do hub), rodando no
// modelo sem censura da Venice AI (API compatível com OpenAI, com function calling e visão).
//
// O histórico continua salvo no formato da Anthropic (chat.messages): aqui ele só é CONVERTIDO na hora de
// montar o pedido. Nada antigo é reescrito (o Claude exige os blocos de thinking intactos); as respostas da
// Venice entram no fim como blocos text/tool_use/tool_result, então dá para alternar entre os modos na mesma conversa.

const URL = "https://api.venice.ai/api/v1/chat/completions";
// Modelo padrão: sem censura e que usa as ferramentas do hub de verdade. Testes de 2026-10-05:
// - venice-uncensored-1-2: diz suportar function calling, mas só descreve a chamada em texto;
// - gemma-4-uncensored: chama, mas inventa dados quando a ferramenta volta vazia;
// - abliteration-abliterated-model-large-v2: chama certo e não inventa (escolhido). Não vê imagens.
// Para trocar, defina VENICE_MODEL no .env.local.
const veniceModel = () => process.env.VENICE_MODEL?.trim() || "abliteration-abliterated-model-large-v2";

// Capacidades do modelo vindas da própria Venice (cacheadas por 1h): sem visão, imagens viram aviso em texto.
let capsCache: { at: number; vision: Map<string, boolean> } | null = null;
async function supportsVision(model: string): Promise<boolean> {
  if (!capsCache || Date.now() - capsCache.at > 3_600_000) {
    try {
      const res = await fetch("https://api.venice.ai/api/v1/models?type=text", { headers: { Authorization: `Bearer ${requireKey("venice")}` } });
      const data = (await res.json()) as { data?: { id: string; model_spec?: { capabilities?: { supportsVision?: boolean } } }[] };
      capsCache = { at: Date.now(), vision: new Map((data.data ?? []).map((m) => [m.id, Boolean(m.model_spec?.capabilities?.supportsVision)])) };
    } catch {
      return false;
    }
  }
  return capsCache.vision.get(model) ?? false;
}

const NO_VISION = "[imagem: o modelo do Modo Black não vê imagens. Para avaliar a imagem, desligue o Modo Black]";
const MAX_STEPS = 40;

// Acrescentado ao prompt de sistema só nos pedidos à Venice (o prompt salvo da conversa não muda).
const BLACK_NOTE = `

# Modo Black
Você está rodando no Modo Black (modelo sem censura). As ferramentas do hub funcionam igual: use-as do mesmo jeito.
- web_search e web_fetch não existem aqui como ferramentas: a pesquisa na web é automática quando a pergunta pede informação atual.
- Tudo que vai para o anúncio (fala, texto na tela, ad text) sai SEMPRE no idioma do mercado, nunca em português (Chile = espanhol chileno, México = espanhol mexicano etc.).
- Responda em markdown normal (tabelas em markdown são bem-vindas). Nunca coloque a resposta inteira dentro de bloco de código.
- Para chamar uma ferramenta, use a chamada de função; não escreva a chamada como texto.`;

type Emit = (event: ChatEvent) => void;

type OaiPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type OaiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OaiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OaiPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type Block = Anthropic.Beta.BetaContentBlockParam;
type ToolResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], string | undefined>[number];

const safeId = (id: string | undefined) => {
  const clean = (id ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  return clean || `call_${randomUUID().replace(/-/g, "")}`;
};

function imageAsPart(block: Anthropic.Beta.BetaImageBlockParam): OaiPart | null {
  if (block.source.type === "base64") return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
  if (block.source.type === "url") return { type: "image_url", image_url: { url: block.source.url } };
  return null;
}

function documentText(block: Anthropic.Beta.BetaRequestDocumentBlock): string {
  return `[PDF anexado: ${block.title ?? "documento"} (o Modo Black não lê PDF; peça um resumo no modo normal)]`;
}

// Histórico (formato Anthropic, já com imagens em base64) → mensagens OpenAI.
function toOpenAI(messages: Anthropic.Beta.BetaMessageParam[], vision: boolean): OaiMessage[] {
  const imagePart = (block: Anthropic.Beta.BetaImageBlockParam): OaiPart | null =>
    vision ? imageAsPart(block) : { type: "text", text: NO_VISION };
  const out: OaiMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push(m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content });
      continue;
    }
    const blocks = m.content as Block[];

    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlockParam).text).join("");
      const calls: OaiToolCall[] = blocks
        .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      // thinking, server_tool_use, web_search/web_fetch results, fallback: a Venice não tem equivalente.
      if (text || calls.length) out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }

    // user: resultados de ferramenta viram mensagens "tool"; imagens dentro deles vão numa mensagem de usuário logo depois.
    const parts: OaiPart[] = [];
    const extraImages: OaiPart[] = [];
    for (const b of blocks) {
      if (b.type === "tool_result") {
        const content = b.content;
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          for (const c of content as ToolResultContent[]) {
            if (c.type === "text") text += c.text;
            else if (c.type === "image") {
              const img = vision ? imageAsPart(c) : null;
              if (img) extraImages.push(img);
              text += img ? "\n[imagem enviada logo abaixo]" : `\n${NO_VISION}`;
            } else if (c.type === "document") text += documentText(c);
          }
        }
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: (b.is_error ? "ERRO: " : "") + (text || "(sem conteúdo)") });
      } else if (b.type === "text") parts.push({ type: "text", text: b.text });
      else if (b.type === "image") {
        const img = imagePart(b);
        if (img) parts.push(img);
      } else if (b.type === "document") parts.push({ type: "text", text: documentText(b) });
    }
    if (extraImages.length) out.push({ role: "user", content: [{ type: "text", text: "Imagem retornada pela ferramenta:" }, ...extraImages] });
    if (parts.length) out.push({ role: "user", content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts });
  }
  return out;
}

class VeniceError extends Error {}

type StepResult = { text: string; calls: { id: string; name: string; args: string }[]; finish: string | null };

// Um pedido em streaming: repassa o texto ao vivo e junta as chamadas de função.
async function step(system: string, messages: OaiMessage[], tools: unknown[], emit: Emit, signal: AbortSignal): Promise<StepResult> {
  const res = await fetch(URL, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${requireKey("venice")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: veniceModel(),
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
      tools,
      tool_choice: "auto",
      venice_parameters: { include_venice_system_prompt: false, enable_web_search: "auto" },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    let detail: unknown = body;
    try {
      const j = JSON.parse(body);
      detail = j.error?.message ?? j.error ?? j.message ?? body;
    } catch {}
    throw new VeniceError(
      res.status === 401 ? "A chave VENICE_API_KEY foi recusada. Confira o hub/.env.local." : `Venice respondeu ${res.status}: ${String(detail).slice(0, 300)}`,
    );
  }

  let text = "";
  let finish: string | null = null;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim().startsWith("data:")) continue;
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]") continue;
      let choice: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null };
      try {
        choice = JSON.parse(data).choices?.[0] ?? {};
      } catch {
        continue; // linha incompleta ou keep-alive
      }
      const delta = choice.delta ?? {};
      if (delta.content) {
        text += delta.content;
        emit({ type: "text", delta: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const cur = calls.get(i) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(i, cur);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  return { text, calls: [...calls.values()].filter((c) => c.name), finish };
}

export async function runVeniceTurn(chat: Chat, emit: Emit, signal: AbortSignal) {
  // Todas as ferramentas atuais, também em conversas antigas (a lista congelada em chat.toolNames só importa no modo HUB_BRAIN=api).
  const defs = toolsFor();
  const tools = defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description ?? "", parameters: d.input_schema } }));
  const system = chat.system + BLACK_NOTE;
  const vision = await supportsVision(veniceModel());

  try {
    for (let i = 0; i < MAX_STEPS && !signal.aborted; i++) {
      const messages = toOpenAI(await hydrateMessages(chat.messages), vision);
      const { text, calls } = await step(system, messages, tools, emit, signal);

      const toolUses: Anthropic.Beta.BetaToolUseBlockParam[] = calls.map((c) => {
        let input: unknown = {};
        try {
          input = c.args.trim() ? JSON.parse(c.args) : {};
        } catch {
          input = { _argumentos_invalidos: c.args };
        }
        return { type: "tool_use", id: safeId(c.id), name: c.name, input };
      });

      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (text.trim()) content.push({ type: "text", text });
      content.push(...toolUses);
      if (!content.length) {
        emit({ type: "error", message: "A Venice não devolveu resposta. Tente de novo." });
        break;
      }
      chat.messages.push({ role: "assistant", content });

      if (!toolUses.length) {
        await saveChat(chat);
        return;
      }

      for (const t of toolUses) {
        emit({ type: "tool", item: { kind: "tool", id: t.id, name: t.name, detail: toolDetail(t.name, t.input), done: false, error: false, summary: "", generations: [] } });
      }
      const outcomes = await Promise.all(
        toolUses.map((t) =>
          "_argumentos_invalidos" in ((t.input ?? {}) as object)
            ? Promise.resolve({ content: "Argumentos inválidos (JSON malformado). Chame a ferramenta de novo com JSON válido.", summary: "argumentos inválidos", error: true, generations: [] })
            : runTool(t.name, t.input, { signal, chat }),
        ),
      );
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((t, idx) => {
        const o = outcomes[idx];
        const generations = o.generations ?? [];
        chat.toolMeta[t.id] = { error: o.error, summary: o.summary, generationIds: generations.map((g) => g.id) };
        emit({ type: "tool_done", id: t.id, error: o.error, summary: o.summary, generations });
        return { type: "tool_result", tool_use_id: t.id, content: o.content, ...(o.error ? { is_error: true } : {}) };
      });
      chat.messages.push({ role: "user", content: results });
      await saveChat(chat);
    }
  } catch (err) {
    if (!signal.aborted) emit({ type: "error", message: err instanceof Error ? err.message : "Erro na Venice" });
  } finally {
    await saveChat(chat).catch(() => undefined);
  }
}
