import { runTts } from "@/lib/server/actions";
import { route } from "@/lib/server/http";

export const POST = route(async (request: Request) => {
  const body = await request.json();
  return Response.json({ generation: await runTts(body) });
});
