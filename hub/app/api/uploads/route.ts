import type { MediaKind } from "@/lib/generations";
import { InputError, route } from "@/lib/server/http";
import { saveMedia } from "@/lib/server/media";
import { createGeneration } from "@/lib/server/store";

// Envio de um arquivo do computador para o hub (ex.: vídeo para o editor).
// FormData: file. Vira uma geração "upload", que pode ser aberta no editor, editada, montada etc.

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

export const POST = route(async (request: Request) => {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new InputError("Escolha um arquivo.");
  if (file.size > MAX_BYTES) throw new InputError("O arquivo pode ter até 1 GB.");

  const kind: MediaKind | null = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("image/") ? "image" : null;
  if (!kind) throw new InputError("Envie um vídeo, áudio ou imagem.");

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const fallback = kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png";
  const saved = await saveMedia(Buffer.from(await file.arrayBuffer()), /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback);
  const generation = await createGeneration({ tool: "upload", kind, status: "done", prompt: file.name || "arquivo enviado", file: saved, params: {} });
  return Response.json({ generation });
});
