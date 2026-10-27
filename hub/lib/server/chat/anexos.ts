import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

import { guardarNoDriveEmSegundoPlano, prazoNoHub } from "@/features/drive/servicos/videos";
import type { Attachment } from "@/lib/chat";
import type { MediaKind } from "@/lib/generations";
import { documentRef, imageRef } from "@/lib/server/chat/images";
import { saveMedia } from "@/lib/server/media";
import { createGeneration } from "@/lib/server/store";

// Anexos de uma mensagem do chat: o que chega pela caixa de mensagem (app/api/chat/route.ts) e o criativo que vem do
// Skala (features/skala/servicos/primeira-mensagem.ts) passam pelo mesmo caminho.

export const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_TEXT_CHARS = 150_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|srt|vtt|ass|html?|xml|ya?ml|log)$/i;

// Vídeo pelo tipo que o navegador informa ou, sem tipo, pela extensão (senão ficaria solto no disco, sem registro).
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpe?g|wmv|flv|mts|m2ts|ogv)$/i;
export const ehVideo = (file: File) => file.type.startsWith("video/") || (!file.type.startsWith("audio/") && !file.type.startsWith("image/") && VIDEO_EXT.test(file.name || ""));

const extOf = (name: string, fallback: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
};

export type Prepared = { attachment: Attachment; blocks: Anthropic.Beta.BetaContentBlockParam[]; note?: string };

// Vídeo ou áudio já gravado na pasta de mídia vira geração do hub (editor, Higgsfield, HeyGen, montagem).
// Vídeo anexado sobe para a pasta "Enviados pela equipe" do Drive; a cópia do hub sai quando o Drive confirma.
// Quem chama confere antes o Drive (exigirDriveParaVideo).
export async function anexoDeMidiaSalva(saved: string, name: string, media: MediaKind): Promise<Prepared> {
  const g = await createGeneration({
    tool: "upload",
    kind: media,
    status: "done",
    prompt: name,
    file: saved,
    params: media === "video" ? { prazoNoHub: prazoNoHub() } : {},
  });
  guardarNoDriveEmSegundoPlano(g);
  return {
    attachment: { name, url: `/api/media/${saved}`, kind: media, generationId: g.id },
    blocks: [],
    note: `${media === "video" ? "vídeo" : "áudio"} "${name}" → generation_id ${g.id}`,
  };
}

// Cada tipo de arquivo vira o que o Claude e as ferramentas conseguem usar:
// imagem → bloco de imagem + geração (referência no FLORA); PDF → bloco de documento;
// texto → conteúdo na mensagem; vídeo/áudio → geração do hub (editor, Higgsfield, HeyGen, montagem).
export async function prepararAnexo(file: File): Promise<Prepared> {
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

  const media: MediaKind | null = ehVideo(file) ? "video" : file.type.startsWith("audio/") ? "audio" : null;
  if (media) {
    const saved = await saveMedia(bytes, extOf(name, media === "video" ? "mp4" : "mp3"));
    return anexoDeMidiaSalva(saved, name, media);
  }

  const saved = await saveMedia(bytes, extOf(name, "bin"));
  return { attachment: { name, url: `/api/media/${saved}`, kind: "file" }, blocks: [], note: `arquivo "${name}" (formato que você não consegue ler; só ficou salvo)` };
}
