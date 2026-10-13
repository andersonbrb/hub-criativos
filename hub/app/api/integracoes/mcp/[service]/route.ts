import { InputError, route } from "@/lib/server/http";
import { isMcpService, mcp } from "@/lib/server/mcp-client";

type Ctx = { params: Promise<{ service: string }> };

const client = async (params: Ctx["params"]) => {
  const { service } = await params;
  if (!isMcpService(service)) throw new InputError("Serviço desconhecido.");
  return mcp(service);
};

export const GET = route(async (_request: Request, { params }: Ctx) => Response.json(await (await client(params)).connectionStatus()));

// Desconecta (apaga a sessão deste servidor; não mexe na conta do serviço).
export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  await (await client(params)).disconnect();
  return Response.json({ connected: false });
});
