import { route } from "@/lib/server/http";
import { renderProject } from "@/lib/server/editor";

export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  return Response.json({ generation: await renderProject((await params).id) });
});
