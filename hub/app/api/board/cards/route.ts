import type { Operation } from "@/lib/board";
import { route } from "@/lib/server/http";
import { createCard, readJson } from "@/lib/server/board";

export const POST = route(async (request: Request) => {
  const body = await readJson(request);
  const card = await createCard({
    columnId: body.columnId as string | undefined,
    title: body.title as string,
    description: body.description as string | undefined,
    operation: body.operation as Operation | undefined,
    product: body.product as string | undefined,
    generationIds: body.generationIds as string[] | undefined,
  });
  return Response.json({ card });
});
