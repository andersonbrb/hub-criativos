import type Anthropic from "@anthropic-ai/sdk";

import { AGENT_PROFILES, getAgentProfile } from "@/lib/agent-profiles";
import { mcpToken } from "@/lib/server/chat/claude-code";
import { buildSystemPrompt } from "@/lib/server/chat/system";
import { logActivity } from "@/lib/server/chat/activity";
import { publicOrigin, verifyAccess, type PersonView } from "@/lib/server/mcp-access";
import { hydrateMessages } from "@/lib/server/chat/images";
import { turnSignal } from "@/lib/server/chat/running";
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

// Quem chama: o Claude Code do próprio hub (chat da tela) ou o Claude Code/Codex de uma pessoa conectada pelo
// "Conectar pelo chat" (token pessoal, lib/server/mcp-access.ts). Para a pessoa, os agentes viram prompts
// (/mcp__hub-criativos__copy…) e o resultado traz links das mídias em vez da tag interna <hub_result>.
type Caller = { kind: "hub" } | { kind: "person"; person: PersonView; origin: string };

const INSTRUCTIONS = `Hub de Criativos: produção de criativos de anúncio (UGC, VSL, estáticos) para Meta/TikTok, com FLORA (imagem e vídeo), ElevenLabs (voz), HeyGen (avatar, tradução), Higgsfield (edição), editor e montagem locais, quadro Kanban e histórico de tudo que foi gerado.
Os agentes do hub (Estrategista, Copy, VSL, Voz, Avatar UGC, B-rolls, Estáticos, Transcrição) estão disponíveis como prompts deste servidor: use o prompt do agente para trabalhar como ele.
Gerações de FLORA, HeyGen e Higgsfield são assíncronas: acompanhe com hub_check_generations. Cada resultado traz o link para ver a mídia no hub (quem abrir precisa da senha do hub). Orce antes de gastar créditos (flora_quote) e confirme com o usuário pedidos caros.`;

function prompts() {
  return [
    { name: "principal", description: "Chat principal do hub: opera todas as ferramentas e playbooks." },
    ...AGENT_PROFILES.map((a) => ({ name: a.id, description: `Agente ${a.name}: ${a.role}` })),
  ];
}

async function handle(req: RpcRequest, chatId: string, signal: AbortSignal, caller: Caller): Promise<unknown | null> {
  const isNotification = req.id === undefined || req.id === null;

  switch (req.method) {
    case "initialize":
      return ok(req.id, {
        protocolVersion: String(req.params?.protocolVersion ?? "2025-06-18"),
        capabilities: { tools: { listChanged: false }, ...(caller.kind === "person" ? { prompts: { listChanged: false } } : {}) },
        serverInfo: SERVER_INFO,
        ...(caller.kind === "person" ? { instructions: INSTRUCTIONS } : {}),
      });
    case "ping":
      return ok(req.id, {});
    case "prompts/list":
      return ok(req.id, { prompts: prompts() });
    case "prompts/get": {
      const name = String(req.params?.name ?? "");
      const agent = getAgentProfile(name);
      if (name !== "principal" && !agent) return fail(req.id, -32602, `Prompt desconhecido: ${name}`);
      const system = await buildSystemPrompt(agent?.id);
      return ok(req.id, {
        description: agent ? `Agente ${agent.name}` : "Chat principal",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `A partir de agora, trabalhe como ${agent ? `o agente ${agent.name}` : "o chat principal"} do Hub de Criativos, usando as ferramentas do servidor MCP hub-criativos. Estas são as suas instruções:\n\n${system}\n\nConfirme em uma linha que está pronto e pergunte o que eu preciso.`,
            },
          },
        ],
      });
    }
    case "tools/list": {
      // Claude Code relista as ferramentas a cada turno (não há prefixo cacheado a proteger):
      // conversas antigas também recebem as ferramentas novas. A lista congelada vale só no modo HUB_BRAIN=api.
      const tools = toolsFor().map((d) => ({ name: d.name, description: d.description ?? "", inputSchema: d.input_schema }));
      return ok(req.id, { tools });
    }
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const chat = chatId ? await getChat(chatId) : null;
      const flora = JSON.stringify(chat?.floraProject ?? null);
      // Para junto com o turno (botão Parar), não só quando a conexão da MCP cai.
      const turn = chatId ? turnSignal(chatId) : undefined;
      const outcome = await runTool(name, args, { signal: turn ? AbortSignal.any([signal, turn]) : signal, chat: chat ?? undefined });
      // Pessoa conectada: o que ela fez aparece na conversa "Claude Code · Nome" do hub.
      if (caller.kind === "person") await logActivity(caller.person, name, args, outcome);

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
      const gens = outcome.generations ?? [];
      if (caller.kind === "hub") {
        const ids = gens.map((g) => g.id).join(",");
        content.push({ type: "text", text: `\n<hub_result summary="${escapeAttr(outcome.summary)}" generations="${ids}" />` });
      } else {
        // Pessoa conectada de fora: caminhos do hub viram links completos (abrem no navegador com a senha do hub).
        for (const c of content) if (c.type === "text") c.text = c.text.replace(/(["(\s])(\/(?:editor\?p=|ver\/|api\/media\/|estudios\/|chat))/g, `$1${caller.origin}$2`);
        const where = caller.person.chatId ? `${caller.origin}/chat?c=${caller.person.chatId}` : `${caller.origin}/chat`;
        const links = gens.map((g) =>
          g.status === "done" && g.file
            ? `- ${g.kind} ${g.id}: ${caller.origin}/ver/${g.id} (arquivo: ${caller.origin}/api/media/${g.file})`
            : g.status === "failed"
              ? `- ${g.kind} ${g.id}: falhou (${g.error ?? "erro"})`
              : `- ${g.kind} ${g.id}: gerando; acompanhe com hub_check_generations. Quando ficar pronto: ${caller.origin}/ver/${g.id}`,
        );
        if (gens.length) content.push({ type: "text", text: `\nNo hub:\n${links.join("\n")}\nTudo também aparece em ${where} (conversa "Claude Code · ${caller.person.name}").` });
      }
      return ok(req.id, { content, isError: outcome.error });
    }
    default:
      if (isNotification) return null; // notifications/initialized etc.
      return fail(req.id, -32601, `Método não suportado: ${req.method}`);
  }
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  let caller: Caller;
  if (auth === `Bearer ${mcpToken()}`) caller = { kind: "hub" };
  else {
    const person = auth.startsWith("Bearer ") ? await verifyAccess(auth.slice(7).trim()) : null;
    if (!person) return Response.json(fail(null, -32001, "Não autorizado: gere um token novo em \"Conectar com a IA\" no hub."), { status: 401 });
    caller = { kind: "person", person, origin: publicOrigin(request) };
  }
  // ?chat= só vale para o chat do próprio hub.
  const chatId = caller.kind === "hub" ? (new URL(request.url).searchParams.get("chat") ?? "") : "";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail(null, -32700, "JSON inválido"), { status: 400 });
  }

  const batch = Array.isArray(body);
  const requests = (batch ? body : [body]) as RpcRequest[];
  const results = (await Promise.all(requests.map((r) => handle(r, chatId, request.signal, caller).catch((err) => fail(r.id, -32603, err instanceof Error ? err.message : "Erro interno"))))).filter(
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
