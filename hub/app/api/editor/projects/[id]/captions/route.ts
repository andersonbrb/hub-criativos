import { route } from "@/lib/server/http";
import { autoCaptions } from "@/lib/server/editor";

// { sourceId?, perCaption? }: transcreve com o ElevenLabs e substitui as legendas dessas fontes.
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const body = await request.json().catch(() => ({}));
  return Response.json({ project: await autoCaptions((await params).id, { sourceId: body.sourceId || undefined, perCaption: body.perCaption }) });
});
