import { route } from "@/lib/server/http";
import { createColumn, readJson } from "@/lib/server/board";

export const POST = route(async (request: Request) => {
  const { title } = await readJson(request);
  return Response.json({ column: await createColumn(title as string) });
});
