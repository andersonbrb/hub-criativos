import { startLogin } from "@/lib/server/heygen-mcp";
import { route } from "@/lib/server/http";

// Endereço público do hub (atrás de proxy, como no Railway, request.url é o endereço interno).
function originOf(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

// "Conectar HeyGen": manda o navegador para o login do HeyGen. ?returnTo=/estudios/traducao
export const GET = route(async (request: Request) => {
  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/estudios/traducao";
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/estudios/traducao";
  return Response.redirect(await startLogin(originOf(request), safe), 302);
});
