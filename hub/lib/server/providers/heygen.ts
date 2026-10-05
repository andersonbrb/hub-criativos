import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { requireKey } from "@/lib/server/env";
import { ProviderError } from "@/lib/server/http";
import { MEDIA_DIR } from "@/lib/server/media";

// HeyGen API v3 (developers.heygen.com). Auth: x-api-key.
const BASE = "https://api.heygen.com";

async function call<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { "x-api-key": requireKey("heygen"), Accept: "application/json", ...init?.headers },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError("HeyGen", res.status, text);
  return JSON.parse(text) as T;
}

// As respostas da v3 às vezes vêm dentro de { data }, às vezes não.
function unwrap<T>(json: unknown): T {
  const j = json as { data?: unknown };
  return (j && typeof j === "object" && "data" in j ? j.data : json) as T;
}

function asList<T>(json: unknown, key: string): T[] {
  const inner = unwrap<unknown>(json);
  if (Array.isArray(inner)) return inner as T[];
  const obj = inner as Record<string, unknown>;
  return (Array.isArray(obj?.[key]) ? obj[key] : []) as T[];
}

export type HeyLook = {
  id: string;
  name: string;
  type: string;
  image: string | null;
  orientation: string | null;
};

export async function listLooks(ownership: "public" | "private"): Promise<HeyLook[]> {
  const json = await call(`/v3/avatars/looks?ownership=${ownership}&limit=50`);
  type Raw = { id: string; name?: string; avatar_type?: string; preview_image_url?: string; preferred_orientation?: string };
  return asList<Raw>(json, "looks").map((l) => ({
    id: l.id,
    name: l.name ?? "Avatar",
    type: l.avatar_type ?? "",
    image: l.preview_image_url ?? null,
    orientation: l.preferred_orientation ?? null,
  }));
}

export type HeyVoice = { id: string; name: string; language: string; gender: string; preview: string | null; own: boolean };

// A lista sem filtro vem cortada em 100 por tipo; filtrar pelo idioma garante as vozes certas (ex.: Spanish).
export async function listVoices(language?: string): Promise<HeyVoice[]> {
  type Raw = { voice_id: string; name: string; language?: string; gender?: string; preview_audio_url?: string };
  const lang = language ? `&language=${encodeURIComponent(language)}` : "";
  const [priv, pub] = await Promise.all([
    call(`/v3/voices?type=private&limit=100`).catch(() => ({ data: [] })),
    call(`/v3/voices?type=public&limit=100${lang}`),
  ]);
  const map = (own: boolean) => (v: Raw): HeyVoice => ({
    id: v.voice_id,
    name: v.name,
    language: v.language ?? "",
    gender: v.gender ?? "",
    preview: v.preview_audio_url ?? null,
    own,
  });
  const mine = asList<Raw>(priv, "voices").map(map(true));
  const ids = new Set(mine.map((v) => v.id));
  const publicVoices = asList<Raw>(pub, "voices")
    .map(map(false))
    .filter((v) => !ids.has(v.id) && (!language || v.language === language));
  return [...mine, ...publicVoices];
}

// Sobe um áudio gerado no hub (ex.: narração do ElevenLabs) para usar no lipsync.
export async function uploadAudio(file: string): Promise<string> {
  const bytes = await readFile(path.join(MEDIA_DIR, file));
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: file.endsWith(".wav") ? "audio/wav" : "audio/mpeg" }), file);
  const json = await call(`/v3/assets`, { method: "POST", body: form });
  const data = unwrap<{ asset_id?: string; id?: string }>(json);
  const id = data.asset_id ?? data.id;
  if (!id) throw new Error("HeyGen não devolveu o id do áudio enviado.");
  return id;
}

export type CreateVideoInput = {
  lookId: string;
  aspectRatio: string;
  resolution: string;
  title: string;
} & ({ script: string; voiceId: string } | { audioAssetId: string });

export async function createVideo(input: CreateVideoInput): Promise<string> {
  const body: Record<string, string> = {
    type: "avatar",
    avatar_id: input.lookId,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    title: input.title,
  };
  if ("audioAssetId" in input) body.audio_asset_id = input.audioAssetId;
  else {
    body.script = input.script;
    body.voice_id = input.voiceId;
  }
  const json = await call(`/v3/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = unwrap<{ video_id?: string; id?: string }>(json);
  const id = data.video_id ?? data.id;
  if (!id) throw new Error("HeyGen não devolveu o id do vídeo.");
  return id;
}

export type HeyVideoStatus = { status: string; url: string | null; error: string | null };

export async function getVideo(id: string): Promise<HeyVideoStatus> {
  const data = unwrap<{ status: string; video_url?: string; failure_message?: string; failure_code?: string }>(
    await call(`/v3/videos/${encodeURIComponent(id)}`),
  );
  return {
    status: data.status,
    url: data.video_url ?? null,
    error: data.failure_message ?? data.failure_code ?? null,
  };
}
