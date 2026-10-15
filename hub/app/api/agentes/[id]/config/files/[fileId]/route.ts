import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { mediaUrlOf } from "@/lib/server/agent-config-view";
import { removeAgentFile } from "@/lib/server/agent-settings";
import { route } from "@/lib/server/http";

// O agente "auto" é o do Criativo automático: quem só tem essa tela também edita ele.
const chaveDoAgente = (id: string) => (id === "auto" ? "criativo-automatico" : "chat");

// Tira um arquivo de referência do agente (e apaga a mídia).
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
  const { id, fileId } = await params;
  await exigirUsuario(chaveDoAgente(id));
  return Response.json({ settings: mediaUrlOf(await removeAgentFile(id, fileId)) });
}, { chave: ["chat", "criativo-automatico"] });
