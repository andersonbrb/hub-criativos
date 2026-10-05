import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, accessPassword, accessToken, loginPage, sameSecret } from "@/lib/server/access";

// Senha de acesso quando o hub está hospedado (HUB_PASSWORD no Railway). No PC, sem a variável, passa tudo.
export function proxy(request: NextRequest) {
  const password = accessPassword();
  if (!password) return NextResponse.next();

  const cookie = request.cookies.get(ACCESS_COOKIE)?.value;
  if (cookie && sameSecret(cookie, accessToken(password))) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Acesso restrito: entre com a senha do hub." }, { status: 401 });
  }
  return new NextResponse(loginPage(pathname + search), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = {
  // Fora: arquivos do Next, ícone, o próprio login e a MCP (que tem token próprio).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/entrar|api/mcp).*)"],
};
