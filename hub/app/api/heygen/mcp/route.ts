import { connectionStatus, disconnect } from "@/lib/server/heygen-mcp";
import { route } from "@/lib/server/http";

// Conexão do hub com o MCP do HeyGen (login OAuth da conta). GET: status. DELETE: desconectar.
// O status basta estar logado (o estúdio de Tradução mostra se está conectado); desconectar é de Integrações.
export const GET = route(async () => Response.json(await connectionStatus()));

export const DELETE = route(async () => {
  await disconnect();
  return Response.json({ connected: false });
}, { chave: "integracoes" });
