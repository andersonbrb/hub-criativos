import { toItems } from "@/lib/server/chat/display";
import { deleteChat, getChat, renameChat, summary } from "@/lib/server/chat/store";
import { InputError, route } from "@/lib/server/http";

export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const chat = await getChat((await params).id);
  if (!chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
  return Response.json({ chat: summary(chat), items: await toItems(chat) });
});

// Renomear: { title }
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const body = (await request.json().catch(() => ({}))) as { title?: unknown };
  const title = String(body.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) throw new InputError("Escreva o nome da conversa.");
  const chat = await renameChat((await params).id, title);
  if (!chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
  return Response.json({ chat: summary(chat) });
});

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await deleteChat((await params).id);
  return Response.json({ ok: true });
});
