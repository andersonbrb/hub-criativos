import { startLogin } from "@/lib/server/heygen-mcp";
import { route } from "@/lib/server/http";

// Endereço público do hub (atrás de proxy, como no Railway, request.url é o endereço interno).
function originOf(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

// Configuração da conexão com o MCP do HeyGen (não há botão na interface: a conexão já vem pronta).
// Uso de administração: abre o login do HeyGen. ?para=nuvem gera a sessão de OUTRO servidor (o hub na nuvem)
// em .data/heygen-mcp-nuvem.json, sem mexer na sessão desta máquina.
export const GET = route(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const returnTo = params.get("returnTo") ?? "/estudios/traducao";
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/estudios/traducao";
  return Response.redirect(await startLogin(originOf(request), safe, params.get("para") === "nuvem" ? "nuvem" : undefined), 302);
});
