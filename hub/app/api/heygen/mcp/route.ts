import { connectionStatus, disconnect } from "@/lib/server/heygen-mcp";
import { route } from "@/lib/server/http";

// Conexão do hub com o MCP do HeyGen (login OAuth da conta). GET: status. DELETE: desconectar.
export const GET = route(async () => Response.json(await connectionStatus()));

export const DELETE = route(async () => {
  await disconnect();
  return Response.json({ connected: false });
});
