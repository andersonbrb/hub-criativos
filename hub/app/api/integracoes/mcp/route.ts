import { route } from "@/lib/server/http";
import { MCP_SERVICES, mcp, type McpServiceId } from "@/lib/server/mcp-client";

// Status da conexão MCP de cada serviço (HeyGen, FLORA, ElevenLabs).
export const GET = route(async () => {
  const ids = Object.keys(MCP_SERVICES) as McpServiceId[];
  const list = await Promise.all(ids.map(async (id) => ({ id, label: MCP_SERVICES[id].label, ...(await mcp(id).connectionStatus()) })));
  return Response.json({ services: list });
});
