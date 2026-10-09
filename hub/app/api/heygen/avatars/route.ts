import { callTool } from "@/lib/server/heygen-mcp";
import { createAvatar, listCreations, type AvatarMode } from "@/lib/server/heygen-avatars";
import { route } from "@/lib/server/http";

type Account = { subscription?: { plan?: string; credits?: { premium_credits?: { remaining?: number | null; resets_at?: string | null } } } };

// GET: criações de avatar em andamento (status atualizado no HeyGen) e o saldo de créditos do plano.
export const GET = route(async () => {
  const [creations, account] = await Promise.all([listCreations(), callTool<Account>("get_current_user").catch(() => null)]);
  const premium = account?.subscription?.credits?.premium_credits;
  return Response.json({
    creations,
    credits: premium ? { remaining: premium.remaining ?? null, resetsAt: premium.resets_at ?? null, plan: account?.subscription?.plan ?? null } : null,
  });
});

// FormData: mode (photo | prompt | twin), name, photo | video | prompt + references[] + aspectRatio.
export const POST = route(async (request: Request) => {
  const form = await request.formData();
  const file = (k: string) => {
    const f = form.get(k);
    return f instanceof File && f.size ? f : null;
  };
  const creation = await createAvatar({
    mode: (["photo", "prompt", "twin"].includes(String(form.get("mode"))) ? form.get("mode") : "photo") as AvatarMode,
    name: String(form.get("name") ?? ""),
    photo: file("photo"),
    video: file("video"),
    prompt: String(form.get("prompt") ?? ""),
    references: form.getAll("references").filter((f): f is File => f instanceof File && f.size > 0),
    aspectRatio: String(form.get("aspectRatio") ?? ""),
  });
  return Response.json({ creation });
});
