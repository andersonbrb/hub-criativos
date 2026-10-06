import { route } from "@/lib/server/http";
import { connectionPrompt, createAccess, listPeople, publicOrigin } from "@/lib/server/mcp-access";

// "Conectar pelo chat": pessoas com o próprio Claude Code/Codex ligado à MCP do hub.
// GET: quem está conectado. POST { name }: token novo + prompt para colar (o token anterior da pessoa para de valer).
export const GET = route(async () => Response.json({ people: await listPeople() }));

export const POST = route(async (request: Request) => {
  const { name } = (await request.json().catch(() => ({}))) as { name?: string };
  const { person, token } = await createAccess(String(name ?? ""));
  return Response.json({ person, prompt: connectionPrompt(publicOrigin(request), token, person.name) });
});
