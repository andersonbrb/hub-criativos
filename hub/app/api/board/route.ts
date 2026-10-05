import { route } from "@/lib/server/http";
import { getBoard, readJson, reorderColumns } from "@/lib/server/board";

export const GET = route(async () => Response.json({ board: await getBoard() }));

// Reordena as colunas: { columnIds }
export const PATCH = route(async (request: Request) => {
  const { columnIds } = await readJson(request);
  return Response.json({ board: await reorderColumns(columnIds as string[]) });
});
