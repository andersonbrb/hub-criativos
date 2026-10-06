import { route } from "@/lib/server/http";
import { brandGlossaries, translationLanguages } from "@/lib/server/video-translation";

// Idiomas aceitos pela tradução e glossários de marca da conta (pelo MCP do HeyGen).
export const GET = route(async () => {
  const [languages, glossaries] = await Promise.all([translationLanguages(), brandGlossaries().catch(() => [])]);
  return Response.json({ languages, glossaries });
});
