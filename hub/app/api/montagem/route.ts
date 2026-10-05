import { route } from "@/lib/server/http";
import { runMontage } from "@/lib/server/montage";

// JSON: { avatarId, brollIds?: string[], lang?: "es" | "pt" | "en", name? }
export const POST = route(async (request: Request) => {
  const body = await request.json();
  return Response.json({ generation: await runMontage(body) });
});
