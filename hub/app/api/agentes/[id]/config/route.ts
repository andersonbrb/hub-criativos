import { getAgentProfile } from "@/lib/agent-profiles";
import { mediaUrlOf } from "@/lib/server/agent-config-view";
import { addAgentFiles, getAgentSettings, REFERENCE_LIMITS, saveAgentTexts } from "@/lib/server/agent-settings";
import { route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// Personalização do agente ("Editar agente"). GET: padrão + personalização. PUT: { instructions, context }.
// POST (multipart, campo files): adiciona arquivos de referência.
export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const settings = await getAgentSettings(id);
  const profile = getAgentProfile(id)!;
  return Response.json({ profile: { name: profile.name, role: profile.role, instructions: profile.instructions }, settings: mediaUrlOf(settings), limits: REFERENCE_LIMITS });
});

export const PUT = route(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return Response.json({ settings: mediaUrlOf(await saveAgentTexts(id, body)) });
});

export const POST = route(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  return Response.json({ settings: mediaUrlOf(await addAgentFiles(id, files)) });
});
