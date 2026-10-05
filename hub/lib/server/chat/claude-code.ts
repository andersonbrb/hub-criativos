import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";

import type { ChatEvent } from "@/lib/chat";
import type { Generation } from "@/lib/generations";
import { hydrateMessages } from "@/lib/server/chat/images";
import { getChat, saveChat, type Chat } from "@/lib/server/chat/store";
import { toolDetail } from "@/lib/server/chat/tools";
import { getGeneration } from "@/lib/server/store";

// "Cérebro" do chat e dos agentes pelo Claude Code instalado nesta máquina, logado na assinatura do usuário
// (claude.ai, plano Max): sem cobrança por token. As ferramentas chegam pela MCP do próprio hub (app/api/mcp).
//
// USO PESSOAL: a assinatura cobre o uso do próprio dono, na máquina dele. Não sirva este backend para outras
// pessoas (equipe, clientes); para isso use a API com chave (HUB_BRAIN=api → lib/server/chat/run.ts).
//
// Isolamento: o Claude Code roda numa pasta vazia FORA do projeto, sem as ferramentas embutidas de arquivo e
// comando (só WebSearch/WebFetch), sem as MCPs da conta (--strict-mcp-config) e sem hooks/plugins/CLAUDE.md do
// usuário (--setting-sources project), então não mexe no código nem no PC.
// Os conectores do claude.ai ficam de fora de propósito: só o do HeyGen tem 107 ferramentas (~150 mil tokens por
// mensagem, gastando o limite do plano); as ferramentas do hub fazem o mesmo, com o mesmo preço de geração.

type Emit = (event: ChatEvent) => void;

// Segredo da MCP do hub: gerado a cada início do servidor (ou HUB_MCP_TOKEN). Sem ele a rota recusa.
export function mcpToken(): string {
  const g = globalThis as { __hubMcpToken?: string };
  g.__hubMcpToken ??= process.env.HUB_MCP_TOKEN?.trim() || randomUUID() + randomUUID();
  return g.__hubMcpToken;
}

// claude.exe: CLAUDE_CODE_BIN, o binário da extensão do VS Code (versão mais nova) ou "claude" do PATH.
export function findClaude(): string | null {
  const env = process.env.CLAUDE_CODE_BIN?.trim();
  if (env) return existsSync(env) ? env : null;
  const exts = path.join(os.homedir(), ".vscode", "extensions");
  try {
    const dirs = readdirSync(exts)
      .filter((d) => d.startsWith("anthropic.claude-code-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of dirs) {
      const bin = path.join(exts, d, "resources", "native-binary", process.platform === "win32" ? "claude.exe" : "claude");
      if (existsSync(bin)) return bin;
    }
  } catch {}
  return process.env.PATH?.split(path.delimiter).some((p) => existsSync(path.join(p, process.platform === "win32" ? "claude.exe" : "claude")))
    ? "claude"
    : null;
}

// O chat (modo normal) consegue responder? Claude Code instalado, ou chave da API com HUB_BRAIN=api.
export function brainReady(): boolean {
  return process.env.HUB_BRAIN?.trim() === "api" ? Boolean(process.env.ANTHROPIC_API_KEY?.trim()) : Boolean(findClaude());
}

// Pasta fixa fora do repositório: as sessões do Claude Code ficam ligadas a ela (o --resume precisa da mesma pasta).
const WORKDIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "HubCriativos", "claude-code");

const TOOL_NOTE = `

# Ferramentas neste ambiente
As ferramentas do hub citadas acima estão disponíveis com o prefixo mcp__hub__ (ex.: hub_list_generations = mcp__hub__hub_list_generations, flora_generate = mcp__hub__flora_generate). web_search = WebSearch e web_fetch = WebFetch. Não existem outras ferramentas: você não lê nem edita arquivos e não roda comandos.`;

// Nome da ferramenta como o hub guarda e mostra (sem o prefixo da MCP).
const hubName = (name: string) =>
  name.startsWith("mcp__hub__") ? name.slice("mcp__hub__".length) : name === "WebSearch" ? "web_search" : name === "WebFetch" ? "web_fetch" : name;

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "") || `toolu_${randomUUID().replace(/-/g, "")}`;

const RESULT_TAG = /<hub_result summary="([^"]*)" generations="([^"]*)" \/>\s*$/;
const unescapeAttr = (s: string) => s.replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content?: unknown; is_error?: boolean };

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join("");
  return "";
}

// Mensagens da conversa que a sessão do Claude Code ainda não viu (ex.: turnos do Modo Black), em texto.
function missedContext(chat: Chat): string {
  const from = chat.claudeSessionId ? (chat.claudeSynced ?? 0) : 0;
  const missed = chat.messages.slice(from, -1);
  const lines: string[] = [];
  for (const m of missed) {
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content
            .map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? `[usou ${b.name}]` : ""))
            .filter(Boolean)
            .join("\n");
    if (text.trim()) lines.push(`${m.role === "user" ? "Usuário" : "Assistente"}: ${text.trim()}`);
  }
  const joined = lines.join("\n\n");
  if (!joined) return "";
  const cut = joined.length > 30_000 ? `…${joined.slice(-30_000)}` : joined;
  return `<contexto_anterior>\nMensagens desta conversa que você ainda não viu (parte delas respondida no Modo Black, por outro modelo):\n\n${cut}\n</contexto_anterior>\n\n`;
}

export async function runClaudeCodeTurn(chat: Chat, emit: Emit, signal: AbortSignal, origin: string) {
  const bin = findClaude();
  if (!bin) {
    emit({ type: "error", message: "Não encontrei o Claude Code nesta máquina. Instale a extensão do Claude Code no VS Code (ou defina CLAUDE_CODE_BIN no .env.local) e faça login com a sua conta do claude.ai." });
    return;
  }

  await mkdir(WORKDIR, { recursive: true });
  const systemFile = path.join(WORKDIR, `${chat.id}.system.md`);
  await writeFile(systemFile, chat.system + TOOL_NOTE);
  const mcpFile = path.join(WORKDIR, `${chat.id}.mcp.json`);
  await writeFile(
    mcpFile,
    JSON.stringify({
      mcpServers: { hub: { type: "http", url: `${origin}/api/mcp?chat=${encodeURIComponent(chat.id)}`, headers: { Authorization: `Bearer ${mcpToken()}` } } },
    }),
  );

  // A mensagem nova do usuário (última de chat.messages), com imagens/PDFs hidratados em base64.
  const [last] = await hydrateMessages(chat.messages.slice(-1));
  const content = (typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content) as Anthropic.Beta.BetaContentBlockParam[];
  const preface = missedContext(chat);
  const userContent = preface ? [{ type: "text" as const, text: preface }, ...content] : content;

  const resuming = Boolean(chat.claudeSessionId);
  const sessionId = chat.claudeSessionId ?? randomUUID();
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--system-prompt-file", systemFile,
    "--mcp-config", mcpFile,
    "--strict-mcp-config",
    // Só configurações do "projeto" (a pasta vazia): não roda hooks/plugins/CLAUDE.md do nível usuário no chat.
    "--setting-sources", "project",
    "--tools", "WebSearch", "WebFetch",
    "--allowedTools", "mcp__hub", "WebSearch", "WebFetch",
    "--model", process.env.HUB_CLAUDE_MODEL?.trim() || "opus",
    ...(resuming ? ["--resume", sessionId] : ["--session-id", sessionId]),
  ];

  const child = spawn(bin, args, { cwd: WORKDIR, windowsHide: true, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "hub" } });
  const kill = () => child.kill();
  signal.addEventListener("abort", kill, { once: true });
  child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: userContent } })}\n`);

  let pending: Anthropic.Beta.BetaContentBlockParam[] = []; // blocos do assistente ainda não gravados
  const toolNames = new Map<string, string>();
  let stderr = "";
  let errored = false;

  const flushAssistant = () => {
    if (pending.length) chat.messages.push({ role: "assistant", content: pending });
    pending = [];
  };

  const persist = async () => {
    // A MCP pode ter gravado o projeto do FLORA no disco durante o turno: não sobrescreve.
    const fresh = await getChat(chat.id).catch(() => null);
    if (fresh?.floraProject) chat.floraProject = fresh.floraProject;
    await saveChat(chat).catch(() => undefined);
  };

  const onEvent = async (ev: Record<string, unknown>) => {
    const type = ev.type;
    // A sessão só vale depois que o Claude Code confirma que ela começou.
    if (type === "system" && ev.subtype === "init" && typeof ev.session_id === "string") {
      chat.claudeSessionId = ev.session_id;
      return;
    }
    if (type === "stream_event") {
      const e = ev.event as { type?: string; delta?: { type?: string; text?: string } };
      if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) emit({ type: "text", delta: e.delta.text });
      return;
    }
    if (type === "assistant") {
      const blocks = ((ev.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string" && b.text) pending.push({ type: "text", text: b.text });
        else if (b.type === "tool_use") {
          const id = safeId(String(b.id));
          const name = hubName(String(b.name));
          toolNames.set(id, name);
          pending.push({ type: "tool_use", id, name, input: (b.input ?? {}) as Record<string, unknown> });
          emit({ type: "tool", item: { kind: "tool", id, name, detail: toolDetail(name, b.input), done: false, error: false, summary: "", generations: [] } });
        }
        // thinking: não guarda (o histórico precisa servir também para a API e o Modo Black)
      }
      return;
    }
    if (type === "user") {
      const blocks = ((ev.message as { content?: unknown[] })?.content ?? []) as ToolResultBlock[];
      const results = blocks.filter((b) => b?.type === "tool_result");
      if (!results.length) return;
      flushAssistant();
      const stored: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const r of results) {
        const id = safeId(String(r.tool_use_id));
        const name = toolNames.get(id) ?? "";
        const text = resultText(r.content);
        const tag = RESULT_TAG.exec(text);
        const ids = tag?.[2] ? tag[2].split(",").filter(Boolean) : [];
        const generations = (await Promise.all(ids.map((g) => getGeneration(g)))).filter((g): g is Generation => Boolean(g));
        const error = Boolean(r.is_error);
        const summary = tag ? unescapeAttr(tag[1]) : name === "web_search" ? "resultados" : name === "web_fetch" ? (error ? "não consegui ler" : "página lida") : error ? text.slice(0, 120) : "ok";
        chat.toolMeta[id] = { error, summary, generationIds: generations.map((g) => g.id) };
        emit({ type: "tool_done", id, error, summary, generations });
        stored.push({ type: "tool_result", tool_use_id: id, content: (tag ? text.replace(RESULT_TAG, "") : text).slice(0, 20_000) || "(sem conteúdo)", ...(error ? { is_error: true } : {}) });
      }
      chat.messages.push({ role: "user", content: stored });
      await persist();
      return;
    }
    if (type === "result") {
      flushAssistant();
      if (ev.is_error || (typeof ev.subtype === "string" && ev.subtype !== "success")) {
        errored = true;
        const msg = String(ev.result ?? ev.subtype ?? "erro");
        emit({ type: "error", message: /limit|usage/i.test(msg) ? `Limite de uso da assinatura atingido: ${msg}` : `Claude Code: ${msg.slice(0, 400)}` });
      }
    }
  };

  // Lê o stdout linha a linha (NDJSON) e processa em ordem.
  let buffer = "";
  let queue = Promise.resolve();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      queue = queue.then(() => onEvent(ev)).catch(() => undefined);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c: string) => (stderr = (stderr + c).slice(-4000)));

  const code = await new Promise<number | null>((resolve) => {
    child.on("error", (err) => {
      stderr += err.message;
      resolve(-1);
    });
    child.on("close", resolve);
  });
  await queue;
  signal.removeEventListener("abort", kill);
  flushAssistant();

  if (!signal.aborted && code !== 0 && !errored) {
    const msg = stderr.trim().split("\n").slice(-3).join(" ");
    emit({
      type: "error",
      message: /not logged|login|auth/i.test(msg)
        ? "O Claude Code não está logado. Abra o Claude Code no VS Code e entre com a sua conta do claude.ai."
        : resuming && /no conversation|not found/i.test(msg)
          ? "A sessão desta conversa não foi encontrada no Claude Code. Envie de novo: o hub vai começar uma sessão nova com o histórico."
          : `Claude Code saiu com erro${msg ? `: ${msg.slice(0, 300)}` : ""}.`,
    });
    if (resuming && /no conversation|not found/i.test(msg)) chat.claudeSessionId = undefined;
  }
  chat.claudeSynced = chat.claudeSessionId ? chat.messages.length : 0;
  await persist();
}
