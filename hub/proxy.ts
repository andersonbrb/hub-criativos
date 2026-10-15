import { NextResponse, type NextRequest } from "next/server";

import { cabecalhoDoCookie, CABECALHO_CAMINHO, COOKIE_SESSAO, pedidoSeguro } from "@/features/acesso/contrato";

// Primeira barreira do login: só confere se o cookie de sessão EXISTE (o proxy não fala com o banco). A conferência
// de verdade (sessão válida, conta ativa, chave da tela) fica em route() nas APIs e em exigirPagina() nas páginas.

// Caminhos que funcionam sem login, cada um com a própria proteção (token do convite, bearer, OAuth) ou público.
const ABERTOS = [
  /^\/entrar\/?$/,
  /^\/aceitar-convite(\/|$)/,
  /^\/sem-acesso\/?$/,
  /^\/api\/acesso\/(entrar|sair)\/?$/,
  /^\/api\/acesso\/convite\//,
  /^\/api\/saude(\/|$)/,
  // Cérebro local (Claude Code no PC): bearer gerado a cada início do servidor.
  /^\/api\/mcp(\/|$)/,
  // Conector novo do Claude Code e o OAuth dele (bearer OAuth).
  /^\/mcp(\/|$)/,
  /^\/oauth2\//,
  /^\/\.well-known\//,
  // Metadados OAuth do hub como cliente (o ElevenLabs lê /oauth/<id>-client.json).
  /^\/oauth\//,
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (ABERTOS.some((r) => r.test(pathname))) return NextResponse.next();

  const sessao = request.cookies.get(COOKIE_SESSAO)?.value;
  if (!sessao) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Entre com a sua conta para continuar." }, { status: 401 });
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
  if (!pathname.startsWith("/api/") && /^[\w-]{20,100}$/.test(sessao)) resposta.headers.append("Set-Cookie", cabecalhoDoCookie(sessao, { seguro: pedidoSeguro(request.url, request.headers) }));
  return resposta;
}

export const config = {
  // Fora do proxy: arquivos do Next, o ícone do site, o ícone do conector e os links de envio e download do conector
  // (token próprio no endereço). Esses links ficam fora de propósito: com o proxy no caminho, o Next guarda o corpo
  // inteiro na memória e corta acima de 500 MB.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|mcp-icone|api/conector/arquivos/).*)"],
};
