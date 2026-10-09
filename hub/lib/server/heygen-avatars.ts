import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { callTool, uploadAsset } from "@/lib/server/heygen-mcp";
import { InputError } from "@/lib/server/http";
import { MEDIA_DIR, saveMedia } from "@/lib/server/media";
import { DATA_DIR } from "@/lib/server/store";

// Criar um avatar novo no HeyGen, como no app deles: por FOTO (photo avatar), por DESCRIÇÃO (prompt avatar)
// ou por VÍDEO da pessoa falando (gêmeo digital, que exige o consentimento da pessoa).
// Vai pelo MCP do HeyGen (mesmo login da Tradução, créditos do plano web). As criações em andamento ficam em
// .data/heygen-avatars.json até o treino terminar; aí o avatar aparece em "Meus avatares" do estúdio.

export type AvatarMode = "photo" | "prompt" | "twin";

export type AvatarCreation = {
  id: string;
  mode: AvatarMode;
  name: string;
  groupId: string | null;
  lookId: string | null;
  status: "training" | "ready" | "failed" | "consent";
  detail: string | null;
  consentUrl: string | null;
  preview: string | null;
  createdAt: string;
};

const STORE = path.join(DATA_DIR, "heygen-avatars.json");

async function load(): Promise<AvatarCreation[]> {
  try {
    return JSON.parse(await readFile(STORE, "utf8")) as AvatarCreation[];
  } catch {
    return [];
  }
}

async function save(list: AvatarCreation[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(`${STORE}.tmp`, JSON.stringify(list, null, 1));
  await rename(`${STORE}.tmp`, STORE);
}

// As respostas do MCP variam de forma; procura a chave em qualquer nível.
function find(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keys.includes(k) && (typeof v === "string" || typeof v === "number") && String(v)) return String(v);
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const hit = find(v, keys);
    if (hit) return hit;
  }
  return null;
}

const GROUP_KEYS = ["avatar_group_id", "group_id", "groupId", "avatarGroupId"];
const LOOK_KEYS = ["avatar_id", "look_id", "lookId", "avatarId", "id"];
const STATUS_KEYS = ["train_status", "training_status", "trainingStatus", "status", "state"];
const PREVIEW_KEYS = ["preview_image_url", "image_url", "previewImageUrl", "preview_url"];

const MAX = { photo: 10 * 1024 * 1024, ref: 10 * 1024 * 1024, video: 2 * 1024 * 1024 * 1024 };

// Salva o arquivo enviado no hub e sobe para o HeyGen; devolve a referência no formato do MCP.
async function asset(file: File, fallbackExt: string) {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const saved = await saveMedia(Buffer.from(await file.arrayBuffer()), /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallbackExt);
  const id = await uploadAsset(path.join(MEDIA_DIR, saved), `avatar:${saved}`, file.type || "application/octet-stream");
  return { type: "asset_id", asset_id: id };
}

export async function createAvatar(input: {
  mode: AvatarMode;
  name: string;
  photo?: File | null;
  video?: File | null;
  prompt?: string;
  references?: File[];
  aspectRatio?: string;
}): Promise<AvatarCreation> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new InputError("Dê um nome ao avatar.");

  let out: unknown;
  if (input.mode === "photo") {
    const photo = input.photo;
    if (!(photo instanceof File) || !photo.size) throw new InputError("Envie uma foto da pessoa.");
    if (!photo.type.startsWith("image/")) throw new InputError("A foto precisa ser uma imagem (JPG, PNG ou WebP).");
    if (photo.size > MAX.photo) throw new InputError("A foto pode ter até 10 MB.");
    out = await callTool("create_photo_avatar", { name, file: await asset(photo, "jpg") });
  } else if (input.mode === "prompt") {
    const prompt = String(input.prompt ?? "").trim();
    if (prompt.length < 10) throw new InputError("Descreva a pessoa com mais detalhes (idade, aparência, roupa, cenário).");
    const refs = (input.references ?? []).filter((f) => f instanceof File && f.size);
    if (refs.length > 3) throw new InputError("No máximo 3 imagens de referência.");
    if (refs.some((f) => !f.type.startsWith("image/") || f.size > MAX.ref)) throw new InputError("As referências precisam ser imagens de até 10 MB.");
    const aspect = ["auto", "16:9", "9:16", "1:1", "4:5", "5:4"].includes(String(input.aspectRatio)) ? input.aspectRatio : "9:16";
    out = await callTool("create_prompt_avatar", {
      name,
      prompt,
      aspectRatio: aspect,
      ...(refs.length ? { referenceImages: await Promise.all(refs.map((f) => asset(f, "jpg"))) } : {}),
    });
  } else {
    const video = input.video;
    if (!(video instanceof File) || !video.size) throw new InputError("Envie o vídeo da pessoa falando.");
    if (!video.type.startsWith("video/")) throw new InputError("Envie um vídeo (MP4 ou MOV).");
    if (video.size > MAX.video) throw new InputError("O vídeo pode ter até 2 GB.");
    out = await callTool("create_digital_twin", { name, file: await asset(video, "mp4") });
  }

  const groupId = find(out, GROUP_KEYS);
  const lookId = find(out, LOOK_KEYS.filter((k) => k !== "id")) ?? (groupId ? null : find(out, ["id"]));
  let consentUrl: string | null = null;
  if (input.mode === "twin" && groupId) {
    // Sem o consentimento da pessoa filmada, o gêmeo digital não gera vídeo. O link vale 24 h e aceita um envio.
    const consent = await callTool("create_avatar_consent", { groupId }).catch(() => null);
    consentUrl = find(consent, ["url", "consent_url", "consentUrl", "link"]);
  }

  const creation: AvatarCreation = {
    id: randomUUID(),
    mode: input.mode,
    name,
    groupId,
    lookId,
    status: consentUrl ? "consent" : "training",
    detail: groupId || lookId ? null : `Resposta do HeyGen sem id: ${JSON.stringify(out).slice(0, 200)}`,
    consentUrl,
    preview: find(out, PREVIEW_KEYS),
    createdAt: new Date().toISOString(),
  };
  await save([creation, ...(await load())]);
  return creation;
}

// Atualiza o status das criações que ainda estão treinando.
export async function listCreations(): Promise<AvatarCreation[]> {
  const list = await load();
  let changed = false;
  for (const c of list) {
    if (c.status === "ready" || c.status === "failed") continue;
    try {
      const info = c.groupId
        ? await callTool("get_avatar_group", { groupId: c.groupId })
        : c.lookId
          ? await callTool("get_avatar_look", { lookId: c.lookId })
          : null;
      if (!info) continue;
      const raw = (find(info, STATUS_KEYS) ?? "").toLowerCase();
      const preview = find(info, PREVIEW_KEYS);
      const next: AvatarCreation["status"] = /fail|error|reject/.test(raw)
        ? "failed"
        : /ready|complete|success|done|finished|active/.test(raw)
          ? "ready"
          : c.status === "consent"
            ? "consent"
            : "training";
      if (next !== c.status || (preview && preview !== c.preview) || raw !== c.detail) {
        Object.assign(c, { status: next, preview: preview ?? c.preview, detail: raw || c.detail });
        changed = true;
      }
    } catch (err) {
      c.detail = err instanceof Error ? err.message.slice(0, 200) : "erro ao consultar";
      changed = true;
    }
  }
  if (changed) await save(list);
  return list;
}

export async function dismissCreation(id: string) {
  await save((await load()).filter((c) => c.id !== id));
}
