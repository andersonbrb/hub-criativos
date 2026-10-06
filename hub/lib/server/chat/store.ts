import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";

import type { Attachment, ChatSummary } from "@/lib/chat";
import { DATA_DIR } from "@/lib/server/store";

// Cada conversa fica em hub/.data/chats/<id>.json.
// `messages` é o histórico exato enviado à API (só cresce: blocos de thinking precisam voltar sem edição).
// Imagens ficam como referência a arquivo local ("@file:<nome>") e são carregadas na hora de enviar.

const CHATS_DIR = path.join(DATA_DIR, "chats");

export type ToolMeta = { error: boolean; summary: string; generationIds: string[] };

export type Chat = ChatSummary & {
  // Prompt de sistema congelado na criação: mudar o prefixo no meio da conversa invalida o cache e o thinking.
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  toolMeta: Record<string, ToolMeta>;
  // Ferramentas disponíveis quando a conversa começou (ausente = todas).
  toolNames?: string[];
  // Anexos de cada mensagem do usuário, pelo índice em `messages` (para mostrar na interface).
  attachments?: Record<number, Attachment[]>;
  // Projeto do FLORA onde esta conversa gera (escolhido pelo usuário na primeira geração: novo ou existente).
  floraProject?: { id: string; name: string };
  // Sessão do Claude Code (cérebro via assinatura, lib/server/chat/claude-code.ts) e quantas mensagens de
  // `messages` ela já conhece; as que vierem depois (ex.: Modo Black) entram como contexto no próximo turno.
  claudeSessionId?: string;
  claudeSynced?: number;
  // Quando o usuário renomeou a conversa: o título dele vale sobre o da 1ª mensagem e sobre um turno em andamento.
  titleRenamedAt?: string;
};

const file = (id: string) => path.join(CHATS_DIR, `${id}.json`);
const validId = (id: string) => /^[\w-]+$/.test(id);

export async function getChat(id: string): Promise<Chat | null> {
  if (!validId(id)) return null;
  try {
    return JSON.parse(await readFile(file(id), "utf8")) as Chat;
  } catch {
    return null;
  }
}

export async function saveChat(chat: Chat) {
  await mkdir(CHATS_DIR, { recursive: true });
  // Um turno guarda a conversa que carregou no início: se ela foi renomeada no meio, mantém o nome novo.
  const disk = await getChat(chat.id);
  if (disk?.titleRenamedAt && (!chat.titleRenamedAt || disk.titleRenamedAt > chat.titleRenamedAt)) {
    chat.title = disk.title;
    chat.titleRenamedAt = disk.titleRenamedAt;
  }
  chat.updatedAt = new Date().toISOString();
  const tmp = `${file(chat.id)}.tmp`;
  await writeFile(tmp, JSON.stringify(chat));
  await rename(tmp, file(chat.id));
}

export const summary = ({ id, title, createdAt, updatedAt, costUsd, agentId }: Chat): ChatSummary => ({
  id,
  title,
  createdAt,
  updatedAt,
  costUsd: costUsd ?? 0,
  ...(agentId ? { agentId } : {}),
});

export function newChat(title: string, system: string, toolNames?: string[], agentId?: string): Chat {
  const now = new Date().toISOString();
  return { id: randomUUID(), title, createdAt: now, updatedAt: now, costUsd: 0, system, messages: [], toolMeta: {}, toolNames, ...(agentId ? { agentId } : {}) };
}

// agentId: só as conversas desse agente; null: só as do chat principal; undefined: todas.
export async function listChats(agentId?: string | null): Promise<ChatSummary[]> {
  const names = await readdir(CHATS_DIR).catch(() => [] as string[]);
  const chats = await Promise.all(
    names.filter((n) => n.endsWith(".json")).map((n) => getChat(n.slice(0, -5))),
  );
  return chats
    .filter((c): c is Chat => Boolean(c))
    .filter((c) => agentId === undefined || (c.agentId ?? null) === agentId)
    .map(summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Conversas completas (para os agentes lerem o trabalho uns dos outros), da mais recente para a mais antiga.
export async function listFullChats(): Promise<Chat[]> {
  const names = await readdir(CHATS_DIR).catch(() => [] as string[]);
  const chats = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => getChat(n.slice(0, -5))));
  return chats.filter((c): c is Chat => Boolean(c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function renameChat(id: string, title: string): Promise<Chat | null> {
  const chat = await getChat(id);
  if (!chat) return null;
  chat.title = title;
  chat.titleRenamedAt = new Date().toISOString();
  // Grava sem mexer em updatedAt: renomear não deve mudar a ordem da lista.
  const tmp = `${file(id)}.tmp`;
  await writeFile(tmp, JSON.stringify(chat));
  await rename(tmp, file(id));
  return chat;
}

export async function deleteChat(id: string) {
  if (validId(id)) await unlink(file(id)).catch(() => undefined);
}
