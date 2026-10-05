import { route } from "@/lib/server/http";
import { listVoices } from "@/lib/server/providers/heygen";

export const GET = route(async (request: Request) => {
  const language = new URL(request.url).searchParams.get("language") ?? undefined;
  return Response.json({ voices: await listVoices(language) });
});
