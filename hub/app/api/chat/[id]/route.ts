import { toItems } from "@/lib/server/chat/display";
import { deleteChat, getChat, summary } from "@/lib/server/chat/store";
import { route } from "@/lib/server/http";

export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const chat = await getChat((await params).id);
  if (!chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
  return Response.json({ chat: summary(chat), items: await toItems(chat) });
});

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await deleteChat((await params).id);
  return Response.json({ ok: true });
});
