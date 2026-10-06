import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

import type { Attachment, ChatEvent } from "@/lib/chat";
import type { MediaKind } from "@/lib/generations";
import { ATTACHMENTS_NOTE } from "@/lib/server/chat/display";
import { documentRef, imageRef } from "@/lib/server/chat/images";
import { findClaude, runClaudeCodeTurn } from "@/lib/server/chat/claude-code";
import { runChatTurn } from "@/lib/server/chat/run";
import { runVeniceTurn } from "@/lib/server/chat/venice";
import { endTurn, startTurn } from "@/lib/server/chat/running";
import { getChat, listChats, newChat, saveChat, summary } from "@/lib/server/chat/store";
import { buildSystemPrompt } from "@/lib/server/chat/system";
import { TOOL_NAMES } from "@/lib/server/chat/tools";
import { hasKey } from "@/lib/server/env";
import { getAgentProfile } from "@/lib/agent-profiles";
import { languageNote } from "@/lib/languages";
import { agentReferenceBlocks } from "@/lib/server/agent-settings";
import { route } from "@/lib/server/http";
import { saveMedia } from "@/lib/server/media";
import { createGeneration } from "@/lib/server/store";

// ?agent=<id>: só as conversas desse agente; sem ele: só as do chat principal.
export const GET = route(async (request: Request) => {
  const agent = new URL(request.url).searchParams.get("agent");
  return Response.json({ chats: await listChats(getAgentProfile(agent)?.id ?? null) });
});

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_TEXT_CHARS = 150_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|srt|vtt|ass|html?|xml|ya?ml|log)$/i;

const extOf = (name: string, fallback: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
};

type Prepared = { attachment: Attachment; blocks: Anthropic.Beta.BetaContentBlockParam[]; note?: string };

// Cada tipo de arquivo vira o que o Claude e as ferramentas conseguem usar:
// imagem → bloco de imagem + geração (referência no FLORA); PDF → bloco de documento;
// texto → conteúdo na mensagem; vídeo/áudio → geração do hub (editor, Higgsfield, HeyGen, montagem).
async function prepare(file: File): Promise<Prepared> {
  const name = file.name || "arquivo";
  const bytes = Buffer.from(await file.arrayBuffer());

  if (file.type.startsWith("image/")) {
    let data: Buffer = bytes;
    let ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    // Acima de 4 MB (limite de referência do FLORA) ou formato exótico (HEIC etc.), vira JPEG.
    if (bytes.length > 4 * 1024 * 1024 || !/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      data = await sharp(bytes).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
      ext = "jpg";
    }
    const saved = await saveMedia(data, ext);
    const g = await createGeneration({ tool: "upload", kind: "image", status: "done", prompt: name, file: saved, params: {} });
    return { attachment: { name, url: `/api/media/${saved}`, kind: "image", generationId: g.id }, blocks: [imageRef(saved)], note: `imagem "${name}" → generation_id ${g.id}` };
  }

  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    const saved = await saveMedia(bytes, "pdf");
    return { attachment: { name, url: `/api/media/${saved}`, kind: "pdf" }, blocks: [documentRef(saved, name)] };
  }

  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(name)) {
    const saved = await saveMedia(bytes, extOf(name, "txt"));
    let text = bytes.toString("utf8");
    const cut = text.length > MAX_TEXT_CHARS;
    if (cut) text = text.slice(0, MAX_TEXT_CHARS);
    return {
      attachment: { name, url: `/api/media/${saved}`, kind: "text" },
      blocks: [{ type: "text", text: `<arquivo nome="${name.replace(/"/g, "'")}">\n${text}\n</arquivo>${cut ? "\n(arquivo cortado: muito longo)" : ""}` }],
    };
  }

  const media: MediaKind | null = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
  if (media) {
    const saved = await saveMedia(bytes, extOf(name, media === "video" ? "mp4" : "mp3"));
    const g = await createGeneration({ tool: "upload", kind: media, status: "done", prompt: name, file: saved, params: {} });
    return {
      attachment: { name, url: `/api/media/${saved}`, kind: media, generationId: g.id },
      blocks: [],
      note: `${media === "video" ? "vídeo" : "áudio"} "${name}" → generation_id ${g.id}`,
    };
  }

  const saved = await saveMedia(bytes, extOf(name, "bin"));
  return { attachment: { name, url: `/api/media/${saved}`, kind: "file" }, blocks: [], note: `arquivo "${name}" (formato que você não consegue ler; só ficou salvo)` };
}

// FormData: text, chatId? (sem ele cria uma conversa nova), agentId? (conversa nova com um agente), files (0 ou mais arquivos de qualquer tipo).
// Responde em NDJSON: uma linha por ChatEvent, até "done".
// mode=black: o mesmo agente, com as mesmas ferramentas, rodando no modelo sem censura da Venice (lib/server/chat/venice.ts).
// Modo normal: Claude Code local com a assinatura (lib/server/chat/claude-code.ts), sem custo por token.
// HUB_BRAIN=api volta para a API da Anthropic com chave (lib/server/chat/run.ts).
export const POST = route(async (request: Request) => {
  // HUB_CHAT=off: chat e agentes desligados (ex.: no Railway, onde não há Claude Code logado).
  if (process.env.HUB_CHAT?.trim() === "off") {
    return Response.json({ error: "O chat está desligado neste servidor. Use o chat no hub do seu computador." }, { status: 403 });
  }
  const form = await request.formData();
  const black = form.get("mode") === "black";
  const useApi = process.env.HUB_BRAIN?.trim() === "api";
  if (black && !hasKey("venice")) {
    return Response.json({ error: "Falta a chave VENICE_API_KEY no hub/.env.local para o Modo Black." }, { status: 400 });
  }
  if (!black && useApi && !hasKey("anthropic")) {
    return Response.json({ error: "Falta a chave ANTHROPIC_API_KEY no hub/.env.local (HUB_BRAIN=api)." }, { status: 400 });
  }
  if (!black && !useApi && !findClaude()) {
    return Response.json(
      { error: "Não encontrei o Claude Code nesta máquina. Instale a extensão do Claude Code no VS Code e entre com a sua conta do claude.ai (ou use HUB_BRAIN=api com ANTHROPIC_API_KEY)." },
      { status: 400 },
    );
  }
  const text = String(form.get("text") ?? "").trim();
  const files = [...form.getAll("files"), ...form.getAll("images")].filter((f): f is File => f instanceof File && f.size > 0);
  if (!text && !files.length) return Response.json({ error: "Escreva uma mensagem." }, { status: 400 });
  if (files.some((f) => f.size > MAX_FILE_BYTES)) return Response.json({ error: "Cada arquivo pode ter até 500 MB." }, { status: 400 });

  const chatId = String(form.get("chatId") ?? "");
  let chat = chatId ? await getChat(chatId) : null;
  if (chatId && !chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
  const shown = text || (files.length === 1 ? `(arquivo anexado: ${files[0].name})` : `(${files.length} arquivos anexados)`);
  // Criativo automático: o título vem do "O que anunciar" do formulário, não do cabeçalho do bloco.
  const titleFrom = /O que anunciar: (.+)/.exec(text.startsWith("[CRIATIVO AUTOMÁTICO]") ? text : "")?.[1].trim() || shown;
  if (!chat) {
    // agentId (só na criação): conversa com um agente; o prompt dele fica congelado na conversa.
    const agentId = getAgentProfile(String(form.get("agentId") ?? ""))?.id;
    chat = newChat(titleFrom.replace(/\s+/g, " ").slice(0, 60), await buildSystemPrompt(agentId), TOOL_NAMES, agentId);
  } else if (chat.messages.length === 0 && !chat.titleRenamedAt) {
    // Conversa criada pelo botão "Nova conversa": ganha o título da primeira mensagem.
    chat.title = titleFrom.replace(/\s+/g, " ").slice(0, 60);
  }

  const prepared = await Promise.all(files.map(prepare));
  const notes = prepared.map((p) => p.note).filter(Boolean);
  // 1ª mensagem de uma conversa de agente: imagens/PDFs de referência configurados em "Editar agente"
  // (só referências "@file:", hidratadas no envio; não entram em chat.attachments, então não viram chips do usuário).
  const references = chat.agentId && chat.messages.length === 0 ? await agentReferenceBlocks(chat.agentId) : [];
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...references,
    ...prepared.flatMap((p) => p.blocks),
    // Idioma do criativo escolhido no chat (lib/languages.ts): nota escondida da bolha, lida pelo agente.
    { type: "text", text: `${shown}${notes.length ? `${ATTACHMENTS_NOTE}${notes.join("; ")}]` : ""}${languageNote(form.get("lang"))}` },
  ];
  const attachments = prepared.map((p) => p.attachment);
  if (attachments.length) chat.attachments = { ...chat.attachments, [chat.messages.length]: attachments };
  chat.messages.push({ role: "user", content });
  await saveChat(chat);

  const current = chat;
  // Só o botão Parar (/api/chat/stop) encerra o turno. Trocar de conversa ou recarregar a página
  // não interrompe: o agente termina e a resposta fica salva na conversa.
  const turn = startTurn(current.id);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {} // o navegador já fechou a conexão
      };
      try {
        emit({ type: "chat", chat: summary(current) });
        emit({ type: "user", item: { kind: "user", text: shown, attachments } });
        if (black) await runVeniceTurn(current, emit, turn.signal);
        else if (useApi) await runChatTurn(current, emit, turn.signal);
        else await runClaudeCodeTurn(current, emit, turn.signal, new URL(request.url).origin);
        emit({ type: "chat", chat: summary(current) });
        emit({ type: "done" });
      } finally {
        endTurn(current.id, turn);
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
});
