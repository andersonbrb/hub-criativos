import { InputError, route } from "@/lib/server/http";
import { isMcpService, mcp, originOf } from "@/lib/server/mcp-client";

// Abre o login do serviço (OAuth). ?volta=/caminho para onde voltar; ?para=nuvem gera a sessão de OUTRO servidor
// (o hub na nuvem) em .data/<id>-mcp-nuvem.json, sem mexer na sessão desta máquina.
export const GET = route(async (request: Request, { params }: { params: Promise<{ service: string }> }) => {
  const { service } = await params;
  if (!isMcpService(service)) throw new InputError("Serviço desconhecido.");
  const q = new URL(request.url).searchParams;
  const volta = q.get("volta") ?? "/integracoes";
  const safe = volta.startsWith("/") && !volta.startsWith("//") ? volta : "/integracoes";
  return Response.redirect(await mcp(service).startLogin(originOf(request), safe, q.get("para") === "nuvem" ? "nuvem" : undefined), 302);
}, { chave: "integracoes" });
