import type { BoardCard } from "@/lib/board";
import { InputError, route } from "@/lib/server/http";
import { deleteCard, getBoard, moveCard, readJson, updateCard } from "@/lib/server/board";

type Ctx = { params: Promise<{ id: string }> };

const FIELDS = ["title", "description", "operation", "product", "generationIds"] as const;

// Edita campos do card e/ou move: { columnId, index? }
export const PATCH = route(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request);
  const patch: Partial<Pick<BoardCard, (typeof FIELDS)[number]>> = {};
  for (const f of FIELDS) if (body[f] !== undefined) Object.assign(patch, { [f]: body[f] });
  const move = body.columnId !== undefined;
  if (!move && !Object.keys(patch).length) throw new InputError("Nada para atualizar.");
  if (Object.keys(patch).length) await updateCard(id, patch);
  if (move) {
    if (typeof body.columnId !== "string") throw new InputError("columnId precisa ser texto.");
    await moveCard(id, body.columnId, body.index === undefined || body.index === null ? undefined : (body.index as number));
  }
  return Response.json({ board: await getBoard() });
});

export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteCard(id);
  return Response.json({ ok: true });
});
