import type { Chave } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { getAgentProfile } from "@/lib/agent-profiles";
import { mediaUrlOf } from "@/lib/server/agent-config-view";
import { addAgentFiles, getAgentSettings, REFERENCE_LIMITS, saveAgentTexts } from "@/lib/server/agent-settings";
import { route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// O agente "auto" é o do Criativo automático: quem só tem essa tela também edita ele.
export const chaveDoAgente = (id: string): Chave => (id === "auto" ? "criativo-automatico" : "chat");
const CHAVES_DE_AGENTE: Chave[] = ["chat", "criativo-automatico"];

// Personalização do agente ("Editar agente"). GET: padrão + personalização. PUT: { instructions, context }.
// POST (multipart, campo files): adiciona arquivos de referência.
export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await exigirUsuario(chaveDoAgente(id));
  const settings = await getAgentSettings(id);
  const profile = getAgentProfile(id)!;
  return Response.json({ profile: { name: profile.name, role: profile.role, instructions: profile.instructions }, settings: mediaUrlOf(settings), limits: REFERENCE_LIMITS });
}, { chave: CHAVES_DE_AGENTE });

export const PUT = route(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  await exigirUsuario(chaveDoAgente(id));
  const body = await request.json().catch(() => ({}));
  return Response.json({ settings: mediaUrlOf(await saveAgentTexts(id, body)) });
}, { chave: CHAVES_DE_AGENTE });

export const POST = route(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  await exigirUsuario(chaveDoAgente(id));
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  return Response.json({ settings: mediaUrlOf(await addAgentFiles(id, files)) });
}, { chave: CHAVES_DE_AGENTE });
