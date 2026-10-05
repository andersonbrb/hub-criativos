import { route } from "@/lib/server/http";
import { deleteProject, getProject, saveProject } from "@/lib/server/editor";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Ctx) => {
  const project = await getProject((await params).id);
  if (!project) return Response.json({ error: "Projeto não encontrado." }, { status: 404 });
  return Response.json({ project });
});

export const PUT = route(async (request: Request, { params }: Ctx) => {
  return Response.json({ project: await saveProject((await params).id, await request.json()) });
});

export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  await deleteProject((await params).id);
  return Response.json({ ok: true });
});
