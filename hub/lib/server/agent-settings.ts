import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";

import { getAgentProfile } from "@/lib/agent-profiles";
import { documentRef, imageRef } from "@/lib/server/chat/images";
import { InputError } from "@/lib/server/http";
import { MEDIA_DIR, saveMedia } from "@/lib/server/media";
import { createGeneration, DATA_DIR, deleteGeneration } from "@/lib/server/store";

// Personalização de cada agente feita pelo usuário (botão "Editar agente"): instruções, contexto e arquivos.
// Fica em hub/.data/agents/<id>.json e vale para os dois modelos (Claude e Venice): entra no prompt de sistema
// das conversas NOVAS do agente (o prompt de uma conversa é congelado na criação) e, imagens e PDFs, anexados
// na primeira mensagem de cada conversa nova. Vídeos e áudios viram gerações do hub (o agente assiste/usa pelas
// ferramentas); textos entram escritos no prompt.

export type AgentFileKind = "image" | "video" | "audio" | "pdf" | "text";
export type AgentFile = { id: string; name: string; kind: AgentFileKind; file: string; size: number; generationId?: string };
export type AgentSettings = { instructions: string; context: string; files: AgentFile[]; updatedAt: string | null };

const DIR = path.join(DATA_DIR, "agents");
const fileOf = (id: string) => path.join(DIR, `${id}.json`);

const MAX_FILES = 20;
const MAX_TEXT_CHARS = 20_000; // por arquivo de texto no prompt
// Imagens e PDFs vão em TODOS os turnos das conversas do agente (contexto e cota): limite baixo.
export const REFERENCE_LIMITS = { images: 5, pdfs: 3, totalMb: 15 };
const MAX_IMAGES_IN_CHAT = REFERENCE_LIMITS.images;
const MAX_PDFS_IN_CHAT = REFERENCE_LIMITS.pdfs;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|srt|vtt|html?|xml|ya?ml)$/i;

const empty = (): AgentSettings => ({ instructions: "", context: "", files: [], updatedAt: null });

function checkAgent(id: string) {
  if (!getAgentProfile(id)) throw new InputError("Agente não encontrado.");
}

export async function getAgentSettings(id: string): Promise<AgentSettings> {
  checkAgent(id);
  try {
    return { ...empty(), ...(JSON.parse(await readFile(fileOf(id), "utf8")) as AgentSettings) };
  } catch {
    return empty();
  }
}

async function write(id: string, s: AgentSettings): Promise<AgentSettings> {
  await mkdir(DIR, { recursive: true });
  s.updatedAt = new Date().toISOString();
  const tmp = `${fileOf(id)}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, fileOf(id));
  return s;
}

export async function saveAgentTexts(id: string, input: { instructions?: unknown; context?: unknown }): Promise<AgentSettings> {
  const s = await getAgentSettings(id);
  if (typeof input.instructions === "string") s.instructions = input.instructions.slice(0, 20_000);
  if (typeof input.context === "string") s.context = input.context.slice(0, 40_000);
  return write(id, s);
}

function kindOf(file: File): AgentFileKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(file.name)) return "text";
  return null;
}

export async function addAgentFiles(id: string, files: File[]): Promise<AgentSettings> {
  const s = await getAgentSettings(id);
  const agent = getAgentProfile(id)!;
  if (s.files.length + files.length > MAX_FILES) throw new InputError(`Cada agente aceita até ${MAX_FILES} arquivos de referência.`);
  // Imagens e PDFs (anexados em toda conversa): até 5 imagens, 3 PDFs e 15 MB somados.
  const count = (k: AgentFileKind) => s.files.filter((f) => f.kind === k).length + files.filter((f) => kindOf(f) === k).length;
  if (count("image") > REFERENCE_LIMITS.images) throw new InputError(`Cada agente aceita até ${REFERENCE_LIMITS.images} imagens de referência.`);
  if (count("pdf") > REFERENCE_LIMITS.pdfs) throw new InputError(`Cada agente aceita até ${REFERENCE_LIMITS.pdfs} PDFs de referência.`);
  const attachedBytes = [...s.files.filter((f) => f.kind === "image" || f.kind === "pdf").map((f) => f.size), ...files.filter((f) => ["image", "pdf"].includes(kindOf(f) ?? "")).map((f) => f.size)].reduce((a, b) => a + b, 0);
  if (attachedBytes > REFERENCE_LIMITS.totalMb * 1024 * 1024) throw new InputError(`Imagens e PDFs de referência somados podem ter até ${REFERENCE_LIMITS.totalMb} MB (eles vão em toda conversa do agente).`);
  for (const f of files) {
    const kind = kindOf(f);
    if (!kind) throw new InputError(`Formato não aceito: ${f.name}. Use imagem, vídeo, áudio, PDF ou texto.`);
    if (f.size > 500 * 1024 * 1024) throw new InputError(`${f.name} passa de 500 MB.`);
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    const fallback = { image: "png", video: "mp4", audio: "mp3", pdf: "pdf", text: "txt" }[kind];
    const saved = await saveMedia(Buffer.from(await f.arrayBuffer()), /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback);
    const entry: AgentFile = { id: randomUUID(), name: f.name || `arquivo.${fallback}`, kind, file: saved, size: f.size };
    // Mídia vira geração do hub (salva na Biblioteca, não some no "Limpar"), para o agente ver/usar pelas ferramentas.
    if (kind === "image" || kind === "video" || kind === "audio") {
      const g = await createGeneration({ tool: "upload", kind, status: "done", prompt: `Referência do agente ${agent.name}: ${entry.name}`, file: saved, params: { agentRef: id }, saved: true });
      entry.generationId = g.id;
    }
    s.files.push(entry);
  }
  return write(id, s);
}

export async function removeAgentFile(id: string, fileId: string): Promise<AgentSettings> {
  const s = await getAgentSettings(id);
  const f = s.files.find((x) => x.id === fileId);
  if (!f) throw new InputError("Arquivo não encontrado.");
  s.files = s.files.filter((x) => x.id !== fileId);
  if (f.generationId) await deleteGeneration(f.generationId);
  await unlink(path.join(MEDIA_DIR, f.file)).catch(() => undefined);
  return write(id, s);
}

const KIND_LABEL: Record<AgentFileKind, string> = { image: "imagem", video: "vídeo", audio: "áudio", pdf: "PDF", text: "texto" };

// Seção do prompt de sistema com a personalização (vazia se o usuário não personalizou).
export async function agentPromptSection(id: string): Promise<string> {
  const s = await getAgentSettings(id).catch(() => empty());
  if (!s.instructions.trim() && !s.context.trim() && !s.files.length) return "";
  const parts = ["\n\n# Personalização deste agente pelo usuário\nO usuário configurou este agente. Siga isto; em conflito com as instruções padrão acima, vale o que está aqui."];
  if (s.instructions.trim()) parts.push(`## Instruções do usuário\n${s.instructions.trim()}`);
  if (s.context.trim()) parts.push(`## Contexto (produto, oferta, público, referências)\n${s.context.trim()}`);
  if (s.files.length) {
    const lines = s.files.map((f) => {
      if (f.kind === "image") return `- ${f.name} (imagem, generation_id ${f.generationId}): anexada no início da conversa; use como referência (ex.: foto do produto no FLORA).`;
      if (f.kind === "pdf") return `- ${f.name} (PDF): anexado no início da conversa.`;
      if (f.kind === "text") return `- ${f.name} (texto): conteúdo abaixo.`;
      return `- ${f.name} (${KIND_LABEL[f.kind]}, generation_id ${f.generationId}): ${f.kind === "video" ? "assista com hub_view_video quando for relevante (ex.: criativo de referência)" : "use nas ferramentas (ex.: lipsync, montagem) ou transcreva com hub_transcribe"}.`;
    });
    parts.push(`## Arquivos de referência\n${lines.join("\n")}`);
    for (const f of s.files.filter((x) => x.kind === "text")) {
      const text = await readFile(path.join(MEDIA_DIR, f.file), "utf8").catch(() => "");
      const cut = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n(cortado: arquivo muito longo)` : text;
      parts.push(`<arquivo_referencia nome="${f.name.replace(/"/g, "'")}">\n${cut}\n</arquivo_referencia>`);
    }
  }
  return parts.join("\n\n");
}

// Imagens e PDFs de referência, anexados na primeira mensagem de cada conversa nova do agente.
export async function agentReferenceBlocks(id: string): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const s = await getAgentSettings(id).catch(() => empty());
  const images = s.files.filter((f) => f.kind === "image").slice(0, MAX_IMAGES_IN_CHAT);
  const pdfs = s.files.filter((f) => f.kind === "pdf").slice(0, MAX_PDFS_IN_CHAT);
  if (!images.length && !pdfs.length) return [];
  return [
    ...images.map((f) => imageRef(f.file)),
    ...pdfs.map((f) => documentRef(f.file, f.name)),
    { type: "text", text: `[Arquivos de referência configurados para este agente: ${[...images, ...pdfs].map((f) => f.name).join(", ")}]` },
  ];
}
