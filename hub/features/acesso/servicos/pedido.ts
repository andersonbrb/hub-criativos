import "server-only";

import { cabecalhoDoCookie, pedidoSeguro, SemPermissao } from "@/features/acesso/contrato";
import type { MetaDaSessao } from "@/features/acesso/servicos/sessoes";
import { InputError } from "@/lib/server/http";

// Ajudantes das rotas de acesso: corpo (formulário ou JSON), IP, cookie e a trava contra envio vindo de outro site.

// IP de quem pediu. No Railway o x-real-ip vem do proxy deles; o x-forwarded-for pode trazer valores inventados
// pelo navegador à esquerda, então vale o último (o que o proxy acrescentou).
export function metaDoPedido(request: Request): MetaDaSessao {
  const encaminhado = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    ip: request.headers.get("x-real-ip")?.trim() || encaminhado?.at(-1) || null,
    navegador: request.headers.get("user-agent"),
  };
}

const ehFormulario = (request: Request) => /application\/x-www-form-urlencoded|multipart\/form-data/.test(request.headers.get("content-type") ?? "");

// Formulário HTML (funciona sem JavaScript) ou JSON (as telas do hub). Corpo vazio vira {}.
export async function lerCorpo(request: Request): Promise<{ dados: Record<string, unknown>; formulario: boolean }> {
  if (ehFormulario(request)) {
    const form = await request.formData().catch(() => null);
    if (!form) throw new InputError("Formulário inválido.");
    return { dados: Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""])), formulario: true };
  }
  const texto = await request.text();
  if (!texto.trim()) return { dados: {}, formulario: false };
  try {
    const json = JSON.parse(texto);
    if (json && typeof json === "object" && !Array.isArray(json)) return { dados: json as Record<string, unknown>, formulario: false };
  } catch {}
  throw new InputError("Pedido inválido: esperava um JSON com os campos do formulário.");
}

// Login, saída e aceite de convite mudam a sessão: um formulário escondido em outro site não pode disparar isso.
// Os navegadores atuais mandam Sec-Fetch-Site em todo pedido; sem ele (curl, script), segue.
export function exigirMesmoSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    const erro = new SemPermissao();
    erro.message = "Pedido recusado: ele veio de outro site. Abra o hub pelo endereço dele e tente de novo.";
    throw erro;
  }
}

export const cookieDeSessao = (request: Request, token: string) => cabecalhoDoCookie(token, { seguro: pedidoSeguro(request.url, request.headers) });
export const cookieApagado = (request: Request) => cabecalhoDoCookie("", { seguro: pedidoSeguro(request.url, request.headers), maxAge: 0 });

export const redirecionar = (destino: string, cookie?: string) =>
  new Response(null, { status: 303, headers: { Location: destino, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
