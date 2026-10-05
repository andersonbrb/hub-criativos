import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "@/lib/server/store";

export const MEDIA_DIR = path.join(DATA_DIR, "media");

export const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
};

export async function saveMedia(data: ArrayBuffer | Buffer, ext: string): Promise<string> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, file), Buffer.isBuffer(data) ? data : Buffer.from(data));
  return file;
}

// Baixa o resultado de uma ferramenta para a pasta local (links das ferramentas costumam expirar).
export async function downloadMedia(url: string, fallbackExt: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não consegui baixar o arquivo gerado (${res.status}).`);
  const fromUrl = new URL(url).pathname.split(".").pop()?.toLowerCase();
  const ext = fromUrl && fromUrl in CONTENT_TYPES ? fromUrl : fallbackExt;
  return saveMedia(await res.arrayBuffer(), ext);
}
