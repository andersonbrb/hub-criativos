import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { DriveNaoConectado, tokenDeAcesso } from "@/features/drive/servicos/conta";
import { lerDoDrive } from "@/features/drive/servicos/videos";
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

  // Vídeo apagado direto no Drive não entra (o hub não tem outra cópia).
  const videos = (await Promise.all(card.generationIds.map((g) => getGeneration(g)))).filter(
    (g): g is NonNullable<typeof g> => Boolean(g && g.kind === "video" && g.status === "done" && !g.foraDoDrive && (g.file || g.remoteUrl)),
  );
  if (!videos.length) throw new InputError("Esse card não tem vídeo pronto para baixar.");

  // Confere o Drive antes de começar: depois que o zip começa a descer, um erro só aparece como um arquivo cortado.
  if (videos.some((g) => g.drive)) {
    try {
      await tokenDeAcesso();
    } catch (err) {
      throw new InputError(
        err instanceof DriveNaoConectado
          ? "Os vídeos desse card estão no Google Drive, e ele não está conectado. Um admin precisa conectar em Integrações → Google Drive."
          : "Não deu para falar com o Google Drive agora, então o zip não foi montado. Tente de novo em instantes.",
      );
    }
  }

  const names = uniqueNames(videos.map((g, i) => `${String(i + 1).padStart(2, "0")} ${downloadName(g)}`));
  const entries: ZipEntry[] = videos.map((g, i) => ({
    name: names[i],
    open: async () => {
      // Relê: o zip desce um vídeo por vez, e nesse meio-tempo um vídeo pode ter ido para o Drive (e saído do disco).
      const atual = (await getGeneration(g.id)) ?? g;
      if (atual.foraDoDrive) throw new Error(`${names[i]} foi apagado no Drive.`);
      if (atual.file) {
        const file = path.join(MEDIA_DIR, path.basename(atual.file));
        if (await access(file).then(() => true, () => false)) return createReadStream(file) as AsyncIterable<Uint8Array>;
      }
      // No Drive: vem em stream de lá, sem cópia no disco.
      if (atual.drive) return Readable.fromWeb((await lerDoDrive(atual)).corpo as never) as AsyncIterable<Uint8Array>;
      if (!atual.remoteUrl) throw new Error(`Arquivo de ${names[i]} não encontrado.`);
      const res = await fetch(atual.remoteUrl);
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
