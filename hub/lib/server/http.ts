import "server-only";

import { NaoAutenticado, podeUsar, SemPermissao, type Chave } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { MissingKeyError } from "@/lib/server/env";

export class ProviderError extends Error {
  constructor(provider: string, status: number, body: string) {
    let detail = body;
    try {
      const json = JSON.parse(body);
      detail = json.detail?.message ?? json.detail ?? json.error?.message ?? json.error ?? json.message ?? body;
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch {}
    super(`${provider} respondeu ${status}: ${detail.slice(0, 300)}`);
  }
}

// Erro de dado inválido vindo de quem chamou (formulário ou agente): vira 400, não 502.
export class InputError extends Error {}

export type OpcoesDaRota = {
  // Chave da tela exigida (features/acesso/contrato.ts). Sem ela, basta estar logado. Com uma lista, qualquer uma
  // delas serve (ex.: o chat atende o Chat principal e o Criativo automático).
  chave?: Chave | Chave[];
  // Rota aberta, sem login (ex.: entrar, saúde, aceitar convite). Use só quando a rota tem a própria proteção.
  publica?: boolean;
};

// Pedido que muda algo vindo de outro site: um formulário escondido ou um fetch numa página de fora usaria o cookie
// de quem está logado para agir em nome dela. Os navegadores atuais mandam Sec-Fetch-Site em todo pedido
// ("same-origin" = do próprio hub; "none" = digitado na barra ou favorito). Sem ele (curl, script), segue: a trava
// protege o navegador da pessoa, não substitui o login.
export function exigirMesmoSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    const erro = new SemPermissao();
    erro.message = "Pedido recusado: ele veio de outro site. Abra o hub pelo endereço dele e tente de novo.";
    throw erro;
  }
}

const mudaAlgo = (pedido: Request) => pedido.method !== "GET" && pedido.method !== "HEAD";

// Envolve um route handler: exige login (e a chave, se pedida) e devolve erros como { error } em JSON,
// legíveis na interface. Quem precisa da pessoa logada dentro do handler chama exigirUsuario() de novo.
// Pedido que muda algo e veio de outro site é recusado antes de tudo (exigirMesmoSite). As rotas abertas que mudam
// a sessão (entrar, sair, aceitar convite) fazem essa conferência por conta própria.
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>, opcoes: OpcoesDaRota = {}) {
  return async (...args: A): Promise<Response> => {
    const pedido = args[0] instanceof Request ? args[0] : null;
    try {
      if (!opcoes.publica) {
        if (pedido && mudaAlgo(pedido)) exigirMesmoSite(pedido);
        const chaves = opcoes.chave === undefined ? [] : [opcoes.chave].flat();
        const usuario = await exigirUsuario(chaves.length === 1 ? chaves[0] : undefined);
        if (chaves.length > 1 && !chaves.some((c) => podeUsar(usuario, c))) throw new SemPermissao(chaves[0]);
      }
      return await fn(...args);
    } catch (err) {
      // Link aberto direto no navegador (ex.: "Conectar HeyGen", baixar arquivos do card): em vez de uma página
      // com JSON, leva para o login ou para a tela de "sem acesso".
      if (pedido?.method === "GET" && pedido.headers.get("sec-fetch-mode") === "navigate") {
        const url = new URL(pedido.url);
        // Location relativo: atrás do proxy do Railway o host de request.url pode ser o interno.
        const ir = (destino: string) => new Response(null, { status: 303, headers: { Location: destino } });
        if (err instanceof NaoAutenticado) return ir(`/entrar?proximo=${encodeURIComponent(url.pathname + url.search)}`);
        if (err instanceof SemPermissao) return ir(`/sem-acesso${err.chave ? `?chave=${err.chave}` : ""}`);
      }
      const status =
        err instanceof NaoAutenticado ? 401 : err instanceof SemPermissao ? 403 : err instanceof MissingKeyError || err instanceof InputError ? 400 : 502;
      const message = err instanceof Error ? err.message : "Erro inesperado";
      console.error("[hub]", message);
      return Response.json({ error: message }, { status });
    }
  };
}
