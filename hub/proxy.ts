import { NextResponse, type NextRequest } from "next/server";

import { cabecalhoDoCookie, CABECALHO_CAMINHO, COOKIE_SESSAO, pedidoSeguro } from "@/features/acesso/contrato";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";

// Primeira barreira do login, só para as PÁGINAS: confere se o cookie de sessão EXISTE (o proxy não fala com o
// banco) e manda quem não tem para /entrar. A conferência de verdade (sessão válida, conta ativa, chave da tela) fica
// em exigirPagina() nas páginas e em route() nas APIs. As APIs nem passam por aqui (veja o matcher no fim).

// Páginas que abrem sem login.
const ABERTOS = [/^\/entrar\/?$/, /^\/aceitar-convite(\/|$)/, /^\/sem-acesso\/?$/];

export function proxy(request: NextRequest) {
  // PC sem banco: sem contas, tudo abre (features/acesso/modo-local.ts).
  if (modoLocalSemBanco()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (ABERTOS.some((r) => r.test(pathname))) return NextResponse.next();

  const sessao = request.cookies.get(COOKIE_SESSAO)?.value;
  if (!sessao) {
    const entrar = new URL("/entrar", request.url);
    entrar.searchParams.set("proximo", pathname + search);
    return NextResponse.redirect(entrar, 307);
  }

  // Repassa o caminho pedido para exigirPagina() mandar a pessoa de volta para cá depois do login.
  const cabecalhos = new Headers(request.headers);
  cabecalhos.set(CABECALHO_CAMINHO, pathname + search);
  const resposta = NextResponse.next({ request: { headers: cabecalhos } });

  // Renova a validade do cookie a cada página aberta: quem usa o hub todo dia não cai no login a cada 30 dias.
  // (O vencimento no banco é renovado por usuarioPeloToken.)
  if (/^[\w-]{20,100}$/.test(sessao)) resposta.headers.append("Set-Cookie", cabecalhoDoCookie(sessao, { seguro: pedidoSeguro(request.url, request.headers) }));
  return resposta;
}

export const config = {
  // O proxy só olha as páginas. Todo pedido que passa por ele (menos GET) tem o corpo inteiro guardado na memória
  // pelo Next, então qualquer POST, mesmo sem conta, ocuparia memória do servidor. Por isso ficam de fora:
  // - arquivos do Next, o ícone do site e o ícone do conector;
  // - /api/: toda rota confere o login sozinha em route() (lib/server/http.ts) ou tem token próprio (/api/mcp com o
  //   bearer do cérebro local, /api/conector/arquivos com o token do link);
  // - o conector do Claude Code e o OAuth dele (/mcp, /oauth2/, /.well-known/), com o bearer OAuth;
  // - /oauth/: os metadados públicos do hub como cliente OAuth (o ElevenLabs lê /oauth/<id>-client.json).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|mcp-icone|api/|mcp(?:/|$)|oauth2/|oauth/|\\.well-known/).*)"],
};
