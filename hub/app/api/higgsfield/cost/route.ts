import { getEditTool } from "@/lib/higgsfield-edits";
import { route } from "@/lib/server/http";
import { editCost } from "@/lib/server/providers/higgsfield";

// Estimativa em créditos de uma edição. Devolve null quando a CLI não consegue estimar.
export const POST = route(async (request: Request) => {
  const { tool: toolId, params, prompt } = await request.json();
  const tool = getEditTool(String(toolId));
  if (!tool) return Response.json({ error: "Ferramenta inválida." }, { status: 400 });
  const credits = await editCost(tool, params ?? {}, prompt || undefined).catch(() => null);
  return Response.json({ credits });
});
