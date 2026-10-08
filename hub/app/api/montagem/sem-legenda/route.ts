import { route } from "@/lib/server/http";
import { runRemoveCaptions } from "@/lib/server/montage";

// Remover legenda queimada (LaMa). JSON: { videoId, region?: "baixo" | "meio" | "topo" | "tudo", mode?: "auto" | "faixa", name? }
export const POST = route(async (request: Request) => {
  const body = await request.json();
  return Response.json({ generation: await runRemoveCaptions(body) });
});
