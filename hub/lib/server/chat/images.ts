import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

import { MEDIA_DIR } from "@/lib/server/media";

// No histórico salvo, imagens são { type: "base64", data: "@file:<nome>" }; aqui viram base64 de verdade.
// Sempre JPEG até 1568 px: cabe no limite da API e é determinístico (mesmo arquivo → mesmos bytes → cache do prompt intacto).

const PREFIX = "@file:";
const cache = new Map<string, string>();

export const documentRef = (file: string, title: string): Anthropic.Beta.BetaRequestDocumentBlock => ({
  type: "document",
  title,
  source: { type: "base64", media_type: "application/pdf", data: `${PREFIX}${file}` },
});

export const imageRef = (file: string): Anthropic.Beta.BetaImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: `${PREFIX}${file}` },
});

async function encode(file: string): Promise<string> {
  let data = cache.get(file);
  if (!data) {
    const buffer = await sharp(path.join(MEDIA_DIR, path.basename(file)))
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    data = buffer.toString("base64");
    cache.set(file, data);
  }
  return data;
}

type ToolResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], string | undefined>[number];
type Block = Anthropic.Beta.BetaContentBlockParam | ToolResultContent;

async function hydrateBlock<T extends Block>(block: T): Promise<T> {
  if (block.type === "image" && block.source.type === "base64" && block.source.data.startsWith(PREFIX)) {
    return { ...block, source: { ...block.source, data: await encode(block.source.data.slice(PREFIX.length)) } };
  }
  if (block.type === "document" && block.source.type === "base64" && block.source.data.startsWith(PREFIX)) {
    const data = (await readFile(path.join(MEDIA_DIR, path.basename(block.source.data.slice(PREFIX.length))))).toString("base64");
    return { ...block, source: { ...block.source, data } };
  }
  if (block.type === "tool_result" && Array.isArray(block.content)) {
    return { ...block, content: await Promise.all(block.content.map((b: ToolResultContent) => hydrateBlock(b))) };
  }
  return block;
}

export async function hydrateMessages(messages: Anthropic.Beta.BetaMessageParam[]) {
  return Promise.all(
    messages.map(async (m) =>
      typeof m.content === "string" ? m : { ...m, content: await Promise.all(m.content.map((b) => hydrateBlock(b))) },
    ),
  );
}
