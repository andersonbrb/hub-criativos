import { route } from "@/lib/server/http";
import { runBeatEdit } from "@/lib/server/montage";

// Edição na batida. JSON: { clipIds: string[], songId?, songStart?, duration?, bpm?, words?: {top, bottom, clip}[], cta?, accent?, name? }
export const POST = route(async (request: Request) => {
  const body = await request.json();
  return Response.json({ generation: await runBeatEdit(body) });
});
