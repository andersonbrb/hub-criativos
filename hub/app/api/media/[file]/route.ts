import { open, stat } from "node:fs/promises";
import path from "node:path";

import { CONTENT_TYPES, MEDIA_DIR } from "@/lib/server/media";

// Serve os arquivos gerados (hub/.data/media) com suporte a Range, para o player de vídeo conseguir avançar.
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[\w-]+\.\w+$/.test(file)) return new Response("Arquivo inválido", { status: 400 });

  const filePath = path.join(MEDIA_DIR, file);
  const info = await stat(filePath).catch(() => null);
  if (!info) return new Response("Não encontrado", { status: 404 });

  const type = CONTENT_TYPES[file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);

  const handle = await open(filePath);
  let start = 0;
  let end = info.size - 1;
  if (range) {
    start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
  }
  const buffer = Buffer.alloc(end - start + 1);
  await handle.read(buffer, 0, buffer.length, start);
  await handle.close();

  return new Response(buffer, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(buffer.length),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
    },
  });
}
