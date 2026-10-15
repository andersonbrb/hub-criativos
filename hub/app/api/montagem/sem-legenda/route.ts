import { route } from "@/lib/server/http";
import { runRemoveCaptions } from "@/lib/server/montage";

// Remover legenda queimada (LaMa). JSON: { videoId, region?: "baixo" | "meio" | "topo" | "tudo", mode?: "auto" | "faixa", name? }
// O botão fica no card de vídeo de várias telas e o LaMa roda local, sem gastar crédito: qualquer uma dessas chaves serve.
export const POST = route(async (request: Request) => {
  const body = await request.json();
  return Response.json({ generation: await runRemoveCaptions(body) });
}, { chave: ["estudios", "biblioteca", "fluxo", "editor", "chat", "criativo-automatico"] });
