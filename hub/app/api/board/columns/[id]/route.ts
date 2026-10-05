import { route } from "@/lib/server/http";
import { deleteColumn, readJson, updateColumn } from "@/lib/server/board";

type Ctx = { params: Promise<{ id: string }> };

// JSON: { title?, color? } (color = id de COLUMN_COLORS em lib/board.ts)
export const PATCH = route(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { title, color } = await readJson(request);
  return Response.json({ column: await updateColumn(id, { title: title as string | undefined, color: color as string | undefined }) });
});

export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteColumn(id);
  return Response.json({ ok: true });
});
