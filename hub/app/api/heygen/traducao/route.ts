import { InputError, route } from "@/lib/server/http";
import { saveMedia } from "@/lib/server/media";
import { runTranslation, type TranslateRequest } from "@/lib/server/video-translation";

// Tradução de vídeo pelo MCP do HeyGen. FormData: options (JSON de TranslateRequest) e srt (arquivo .srt opcional).
// Cria uma geração por idioma; o status é acompanhado em /api/heygen/jobs/<id>.
export const POST = route(async (request: Request) => {
  const form = await request.formData();
  let options: TranslateRequest;
  try {
    options = JSON.parse(String(form.get("options") ?? "{}")) as TranslateRequest;
  } catch {
    throw new InputError("Opções inválidas.");
  }
  const srt = form.get("srt");
  if (srt instanceof File && srt.size > 0) {
    if (!/\.srt$/i.test(srt.name)) throw new InputError("A legenda precisa ser um arquivo .srt.");
    options.srtFile = await saveMedia(Buffer.from(await srt.arrayBuffer()), "srt");
  } else {
    options.srtFile = null;
  }
  return Response.json({ generations: await runTranslation(options) });
});
