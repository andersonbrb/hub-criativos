import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { downloadName } from "@/lib/generations";
import { getBoard } from "@/lib/server/board";
import { InputError, route } from "@/lib/server/http";
import { MEDIA_DIR } from "@/lib/server/media";
import { getGeneration } from "@/lib/server/store";
import { uniqueNames, zipStream, type ZipEntry } from "@/lib/server/zip";

type Ctx = { params: Promise<{ id: string }> };

const safeName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "criativo";

// Baixa todos os vídeos vinculados ao card num .zip só (na ordem do card).
export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const card = (await getBoard()).cards[id];
  if (!card) throw new InputError("Card não encontrado.");

  const videos = (await Promise.all(card.generationIds.map((g) => getGeneration(g)))).filter(
    (g): g is NonNullable<typeof g> => Boolean(g && g.kind === "video" && g.status === "done" && (g.file || g.remoteUrl)),
  );
  if (!videos.length) throw new InputError("Esse card não tem vídeo pronto para baixar.");

  const names = uniqueNames(videos.map((g, i) => `${String(i + 1).padStart(2, "0")} ${downloadName(g)}`));
  const entries: ZipEntry[] = videos.map((g, i) => ({
    name: names[i],
    open: async () => {
      if (g.file) {
        const file = path.join(MEDIA_DIR, path.basename(g.file));
        if (await access(file).then(() => true, () => false)) return createReadStream(file) as AsyncIterable<Uint8Array>;
      }
      if (!g.remoteUrl) throw new Error(`Arquivo de ${names[i]} não encontrado.`);
      const res = await fetch(g.remoteUrl);
      if (!res.ok || !res.body) throw new Error(`Não consegui baixar ${names[i]} (${res.status}).`);
      return Readable.fromWeb(res.body as never) as AsyncIterable<Uint8Array>;
    },
  }));

  const zipName = `${safeName(card.title)}.zip`;
  return new Response(zipStream(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "no-store",
    },
  });
}, { chave: "fluxo" });
