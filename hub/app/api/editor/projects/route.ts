import { route } from "@/lib/server/http";
import { libraryVideos, listProjects, openProject } from "@/lib/server/editor";

export const GET = route(async () => Response.json({ projects: await listProjects(), videos: await libraryVideos() }));

// { generationId }: abre o vídeo no editor (reaproveita o projeto se já existir).
export const POST = route(async (request: Request) => {
  const body = await request.json();
  return Response.json({ project: await openProject(String(body.generationId ?? "")) });
});
