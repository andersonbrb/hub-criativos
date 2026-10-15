import "server-only";

// Endereços, prazos e escopos do conector, lidos num lugar só.
//
// HUB_PUBLIC_URL é o endereço público do hub. Dele saem o recurso protegido do OAuth (<base>/mcp) e o emissor
// (<base>), e o recurso tem de bater EXATAMENTE com o endereço que a pessoa colou no Claude: errado, a conexão não
// fecha. Sem a variável (no PC), vale a origem da própria requisição, então http://localhost:3000 funciona sem
// configurar nada.

export const NOME_DO_SERVIDOR = "hub-criativos";
export const TITULO_DO_SERVIDOR = "Hub de Criativos";
export const VERSAO_DO_SERVIDOR = "1.0.0";

// hub.memoria é o único poder que o token carrega: o que a pessoa pode fazer de fato sai das chaves da conta a cada
// chamada. offline_access é o pedido do token de renovação.
export const ESCOPO_HUB = "hub.memoria";
export const ESCOPO_OFFLINE = "offline_access";

// O código é curto porque o Claude troca na hora; o pedido dá tempo de a pessoa fazer login no meio do caminho.
export const VALIDADE_PEDIDO_MS = 10 * 60_000;
export const VALIDADE_CODIGO_MS = 60_000;
export const VALIDADE_ACESSO_MS = 60 * 60_000;
export const VALIDADE_RENOVACAO_MS = 30 * 24 * 60 * 60_000;
// Conexão esquecida num notebook antigo não pode valer para sempre.
export const INATIVIDADE_MAXIMA_MS = 60 * 24 * 60 * 60_000;

export const ROTA_CONSENTIMENTO = "/conectar-claude";

// Os dois endereços do Claude na web. O loopback do Claude Code vale sempre, à parte (servicos/oauth.ts).
const REDIRECTS_PADRAO = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

export function basePublica(request?: Request): string {
  const configurada = process.env.HUB_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configurada) return configurada;
  if (request) return new URL(request.url).origin;
  return "http://localhost:3000";
}

// A mesma base, para as páginas (componentes de servidor), que têm os cabeçalhos e não o Request.
export function basePublicaDeCabecalhos(h: Headers): string {
  const configurada = process.env.HUB_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configurada) return configurada;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export const enderecoMcp = (base: string) => `${base}/mcp`;
export const metadadosDoRecurso = (base: string) => `${base}/.well-known/oauth-protected-resource/mcp`;

export function redirectsPermitidos(): string[] {
  const lista = (process.env.MCP_REDIRECTS_PERMITIDOS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return lista.length ? lista : REDIRECTS_PADRAO;
}
