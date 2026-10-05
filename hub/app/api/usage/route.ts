import { route } from "@/lib/server/http";
import { account } from "@/lib/server/providers/higgsfield";
import { listGenerations } from "@/lib/server/store";

// Rodapé do menu: gasto real da FLORA (soma do charged_cost das gerações salvas) e créditos do Higgsfield (CLI).
// Os créditos ficam em cache por 1 min para não chamar a CLI a cada página.
let hfCache: { at: number; credits: number | null } | null = null;

async function higgsfieldCredits(): Promise<number | null> {
  if (hfCache && Date.now() - hfCache.at < 60_000) return hfCache.credits;
  const credits = await account()
    .then((a) => a.credits)
    .catch(() => null);
  hfCache = { at: Date.now(), credits };
  return credits;
}

export const GET = route(async () => {
  const [flora, credits] = await Promise.all([listGenerations("flora"), higgsfieldCredits()]);
  const floraSpent = flora.reduce((sum, g) => sum + (typeof g.params.cost === "number" ? g.params.cost : 0), 0);
  return Response.json({ floraSpent, floraCount: flora.length, higgsfieldCredits: credits });
});
