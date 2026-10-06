import { route } from "@/lib/server/http";
import { revokeAccess } from "@/lib/server/mcp-access";

// Desconecta uma pessoa (o token dela para de funcionar na hora).
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await revokeAccess((await params).id);
  return Response.json({ ok: true });
});
