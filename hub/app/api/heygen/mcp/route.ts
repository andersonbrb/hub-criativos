import { connectionStatus, disconnect } from "@/lib/server/heygen-mcp";
import { route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO } from "@/lib/server/media";

// Conexão do hub com o MCP do HeyGen (login OAuth da conta). GET: status. DELETE: desconectar.
// O status vale para as telas de produção (o estúdio de Tradução mostra se está conectado); desconectar é de
// Integrações.
export const GET = route(async () => Response.json(await connectionStatus()), { chave: CHAVES_DE_PRODUCAO });

export const DELETE = route(async () => {
  await disconnect();
  return Response.json({ connected: false });
}, { chave: "integracoes" });
