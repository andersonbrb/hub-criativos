import type Anthropic from "@anthropic-ai/sdk";

import { mcpToken } from "@/lib/server/chat/claude-code";
import { hydrateMessages } from "@/lib/server/chat/images";
import { getChat, saveChat } from "@/lib/server/chat/store";
import { runTool, toolsFor } from "@/lib/server/chat/tools";

// Servidor MCP do próprio hub (Streamable HTTP, sem estado, respostas JSON).
// Quem usa: o Claude Code local que roda o chat e os agentes (lib/server/chat/claude-code.ts).
// Expõe as mesmas ferramentas do chat (histórico, FLORA, HeyGen, ElevenLabs, Higgsfield, editor, montagem, quadro…).
// ?chat=<id> diz de qual conversa é a chamada (projeto do FLORA, lista de ferramentas da conversa).
// O fim de cada resultado traz <hub_result …/> com o resumo e as gerações, que o hub usa para montar os cards.

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const SERVER_INFO = { name: "hub", version: "1.0.0" };

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\n/g, " ");

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

async function handle(req: RpcRequest, chatId: string, signal: AbortSignal): Promise<unknown | null> {
  const isNotification = req.id === undefined || req.id === null;

  switch (req.method) {
    case "initialize":
      return ok(req.id, {
        protocolVersion: String(req.params?.protocolVersion ?? "2025-06-18"),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return ok(req.id, {});
    case "tools/list": {
      const chat = chatId ? await getChat(chatId) : null;
      const tools = toolsFor(chat?.toolNames).map((d) => ({ name: d.name, description: d.description ?? "", inputSchema: d.input_schema }));
      return ok(req.id, { tools });
    }
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const chat = chatId ? await getChat(chatId) : null;
      const flora = JSON.stringify(chat?.floraProject ?? null);
      const outcome = await runTool(name, args, { signal, chat: chat ?? undefined });

      // A ferramenta pode ter escolhido o projeto do FLORA da conversa: grava na hora.
      if (chat && JSON.stringify(chat.floraProject ?? null) !== flora) {
        const fresh = await getChat(chat.id);
        if (fresh) await saveChat({ ...fresh, floraProject: chat.floraProject });
      }

      const content: McpContent[] = [];
      if (typeof outcome.content === "string") content.push({ type: "text", text: outcome.content });
      else {
        // Imagens do hub ficam como "@file:" no histórico: vira base64 de verdade aqui.
        const [msg] = await hydrateMessages([
          { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: outcome.content }] },
        ]);
        const blocks = ((msg.content as Anthropic.Beta.BetaToolResultBlockParam[])[0].content ?? []) as Exclude<
          Anthropic.Beta.BetaToolResultBlockParam["content"],
          string | undefined
        >;
        for (const b of blocks) {
          if (b.type === "text") content.push({ type: "text", text: b.text });
          else if (b.type === "image" && b.source.type === "base64") content.push({ type: "image", data: b.source.data, mimeType: b.source.media_type });
        }
      }
      const ids = (outcome.generations ?? []).map((g) => g.id).join(",");
      content.push({ type: "text", text: `\n<hub_result summary="${escapeAttr(outcome.summary)}" generations="${ids}" />` });
      return ok(req.id, { content, isError: outcome.error });
    }
    default:
      if (isNotification) return null; // notifications/initialized etc.
      return fail(req.id, -32601, `Método não suportado: ${req.method}`);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${mcpToken()}`) {
    return Response.json(fail(null, -32001, "Não autorizado"), { status: 401 });
  }
  const chatId = new URL(request.url).searchParams.get("chat") ?? "";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail(null, -32700, "JSON inválido"), { status: 400 });
  }

  const batch = Array.isArray(body);
  const requests = (batch ? body : [body]) as RpcRequest[];
  const results = (await Promise.all(requests.map((r) => handle(r, chatId, request.signal).catch((err) => fail(r.id, -32603, err instanceof Error ? err.message : "Erro interno"))))).filter(
    (r) => r !== null,
  );

  if (!results.length) return new Response(null, { status: 202 });
  return Response.json(batch ? results : results[0]);
}

// Sem stream de notificações do servidor (só respostas JSON).
export function GET() {
  return new Response("Use POST", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 204 });
}
