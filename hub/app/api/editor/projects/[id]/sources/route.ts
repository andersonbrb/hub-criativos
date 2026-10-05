import { route } from "@/lib/server/http";
import { addSource } from "@/lib/server/editor";

// { generationId }: coloca outro vídeo do hub no fim da timeline.
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const body = await request.json();
  return Response.json({ project: await addSource((await params).id, String(body.generationId ?? "")) });
});
