import "server-only";

import path from "node:path";

import { callTool, uploadAsset } from "@/lib/server/heygen-mcp";
import { MEDIA_DIR } from "@/lib/server/media";

// HeyGen pelo MCP (mcp.heygen.com, login da conta em Integrações): avatares, vozes e vídeo do avatar falando.
// Consome os créditos do plano web do HeyGen, não o saldo da API.

// As respostas às vezes vêm dentro de { data }, às vezes não.
function unwrap<T>(json: unknown): T {
  const j = json as { data?: unknown };
  return (j && typeof j === "object" && "data" in j && j.data !== null ? j.data : json) as T;
}

function asList<T>(json: unknown, ...keys: string[]): T[] {
  const inner = unwrap<unknown>(json);
  if (Array.isArray(inner)) return inner as T[];
  const obj = (inner ?? {}) as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as T[];
  return [];
}

export type HeyLook = {
  id: string;
  name: string;
  type: string;
  image: string | null;
  orientation: string | null;
};

export async function listLooks(ownership: "public" | "private"): Promise<HeyLook[]> {
  type Raw = { id: string; name?: string; avatar_type?: string; preview_image_url?: string; preferred_orientation?: string };
  const json = await callTool("list_avatar_looks", { ownership, limit: 50 });
  return asList<Raw>(json, "looks", "items").map((l) => ({
    id: l.id,
    name: l.name ?? "Avatar",
    type: l.avatar_type ?? "",
    image: l.preview_image_url ?? null,
    orientation: l.preferred_orientation ?? null,
  }));
}

export type HeyVoice = { id: string; name: string; language: string; gender: string; preview: string | null; own: boolean };

// A lista sem filtro vem cortada; filtrar pelo idioma garante as vozes certas (ex.: Spanish). As suas vêm primeiro.
export async function listVoices(language?: string): Promise<HeyVoice[]> {
  type Raw = { voice_id: string; name: string; language?: string; gender?: string; preview_audio_url?: string };
  const [priv, pub] = await Promise.all([
    callTool("list_voices", { type: "private", limit: 100 }).catch(() => ({ data: [] })),
    callTool("list_voices", { type: "public", limit: 100, ...(language ? { language } : {}) }),
  ]);
  const map = (own: boolean) => (v: Raw): HeyVoice => ({
    id: v.voice_id,
    name: v.name,
    language: v.language ?? "",
    gender: v.gender ?? "",
    preview: v.preview_audio_url ?? null,
    own,
  });
  const mine = asList<Raw>(priv, "voices", "items").map(map(true));
  const ids = new Set(mine.map((v) => v.id));
  const publicVoices = asList<Raw>(pub, "voices", "items")
    .map(map(false))
    .filter((v) => !ids.has(v.id) && (!language || v.language === language));
  return [...mine, ...publicVoices];
}

// Sobe um áudio gerado no hub (ex.: narração do ElevenLabs) para usar no lipsync.
export async function uploadAudio(file: string): Promise<string> {
  return uploadAsset(path.join(MEDIA_DIR, file), `audio:${file}`, file.endsWith(".wav") ? "audio/wav" : "audio/mpeg");
}

export type CreateVideoInput = {
  lookId: string;
  aspectRatio: string;
  resolution: string;
  title: string;
} & ({ script: string; voiceId: string } | { audioAssetId: string });

export async function createVideo(input: CreateVideoInput): Promise<string> {
  const args: Record<string, unknown> = {
    avatarId: input.lookId,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    title: input.title,
  };
  if ("audioAssetId" in input) args.audioAssetId = input.audioAssetId;
  else {
    args.script = input.script;
    args.voiceId = input.voiceId;
  }
  const data = unwrap<{ video_id?: string; videoId?: string; id?: string }>(await callTool("create_video_from_avatar", args));
  const id = data.video_id ?? data.videoId ?? data.id;
  if (!id) throw new Error("HeyGen não devolveu o id do vídeo.");
  return id;
}

export type HeyVideoStatus = { status: string; url: string | null; error: string | null };

export async function getVideo(id: string): Promise<HeyVideoStatus> {
  const data = unwrap<{ status: string; video_url?: string; failure_message?: string; failure_code?: string }>(
    await callTool("get_video", { videoId: id }),
  );
  return {
    status: data.status,
    url: data.video_url ?? null,
    error: data.failure_message ?? data.failure_code ?? null,
  };
}
