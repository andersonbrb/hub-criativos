import { route } from "@/lib/server/http";
import { isMcpService, mcp } from "@/lib/server/mcp-client";

// Volta do login do serviço: troca o código pelos tokens e retorna para a tela de onde saiu.
export const GET = route(async (request: Request, { params }: { params: Promise<{ service: string }> }) => {
  const { service } = await params;
  const url = new URL(request.url);
  const back = (path: string, status: string) =>
    new Response(null, { status: 302, headers: { Location: `${path}${path.includes("?") ? "&" : "?"}mcp=${service}-${status}` } });
  if (!isMcpService(service)) return back("/integracoes", "erro");
  const code = url.searchParams.get("code");
  if (!code) return back("/integracoes", url.searchParams.get("error") === "access_denied" ? "cancelado" : "erro");
  try {
    return back(await mcp(service).finishLogin(code, url.searchParams.get("state") ?? ""), "conectado");
  } catch (err) {
    console.error(`[hub] login ${service}:`, err instanceof Error ? err.message : err);
    return back("/integracoes", "erro");
  }
}, { chave: "integracoes" });
