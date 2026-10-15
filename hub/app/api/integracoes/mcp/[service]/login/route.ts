import { caminhoSeguro } from "@/features/acesso/contrato";
import { InputError, route } from "@/lib/server/http";
import { isMcpService, mcp, originOf } from "@/lib/server/mcp-client";

// Abre o login do serviço (OAuth). ?volta=/caminho para onde voltar; ?para=nuvem gera a sessão de OUTRO servidor
// (o hub na nuvem) em .data/<id>-mcp-nuvem.json, sem mexer na sessão desta máquina.
export const GET = route(async (request: Request, { params }: { params: Promise<{ service: string }> }) => {
  const { service } = await params;
  if (!isMcpService(service)) throw new InputError("Serviço desconhecido.");
  const q = new URL(request.url).searchParams;
  // Só caminho dentro do hub: "/\site.com" passaria por uma conferência ingênua e o navegador iria para outro site.
  const volta = caminhoSeguro(q.get("volta"), "/integracoes");
  return Response.redirect(await mcp(service).startLogin(originOf(request), volta, q.get("para") === "nuvem" ? "nuvem" : undefined), 302);
}, { chave: "integracoes" });
