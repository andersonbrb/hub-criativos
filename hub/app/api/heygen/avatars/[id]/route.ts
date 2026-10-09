import { dismissCreation } from "@/lib/server/heygen-avatars";
import { route } from "@/lib/server/http";

// Tira a criação da lista do hub (não apaga o avatar no HeyGen).
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await dismissCreation((await params).id);
  return Response.json({ ok: true });
});
