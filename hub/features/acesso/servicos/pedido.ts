import "server-only";

import { cabecalhoDoCookie, pedidoSeguro } from "@/features/acesso/contrato";
import type { MetaDaSessao } from "@/features/acesso/servicos/sessoes";
import { lerCorpo as lerAteOTeto } from "@/features/conector/servicos/http";
import { InputError } from "@/lib/server/http";

// Ajudantes das rotas de acesso: corpo (formulário ou JSON), IP, cookie e a trava contra envio vindo de outro site.

// A trava mora em lib/server/http.ts (o route() usa em toda rota que muda algo); as rotas abertas de acesso
// (entrar, sair, aceitar convite) chamam daqui.
export { exigirMesmoSite } from "@/lib/server/http";

// IP de quem pediu. No Railway o x-real-ip vem do proxy deles; o x-forwarded-for pode trazer valores inventados
// pelo navegador à esquerda, então vale o último (o que o proxy acrescentou).
export function metaDoPedido(request: Request): MetaDaSessao {
  const encaminhado = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    ip: request.headers.get("x-real-ip")?.trim() || encaminhado?.at(-1) || null,
    navegador: request.headers.get("user-agent"),
  };
}

// Login, convite e membros cabem com folga em 16 KB. Entrar e aceitar convite respondem a quem não tem conta: sem
// teto, um corpo gigante entraria inteiro na memória do servidor.
const TETO_DO_CORPO = 16 * 1024;

const ehFormulario = (request: Request) => /application\/x-www-form-urlencoded|multipart\/form-data/.test(request.headers.get("content-type") ?? "");

// Formulário HTML (funciona sem JavaScript) ou JSON (as telas do hub). Corpo vazio vira {}.
export async function lerCorpo(request: Request): Promise<{ dados: Record<string, unknown>; formulario: boolean }> {
  const texto = await lerAteOTeto(request, TETO_DO_CORPO);
  if (texto === null) throw new InputError("Pedido grande demais.");
  if (ehFormulario(request)) {
    // O corpo já foi lido (com teto); o formulário é montado de novo a partir dele, com o mesmo Content-Type.
    const form = await new Response(texto, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData().catch(() => null);
    if (!form) throw new InputError("Formulário inválido.");
    return { dados: Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""])), formulario: true };
  }
  if (!texto.trim()) return { dados: {}, formulario: false };
  try {
    const json = JSON.parse(texto);
    if (json && typeof json === "object" && !Array.isArray(json)) return { dados: json as Record<string, unknown>, formulario: false };
  } catch {}
  throw new InputError("Pedido inválido: esperava um JSON com os campos do formulário.");
}

export const cookieDeSessao = (request: Request, token: string) => cabecalhoDoCookie(token, { seguro: pedidoSeguro(request.url, request.headers) });
export const cookieApagado = (request: Request) => cabecalhoDoCookie("", { seguro: pedidoSeguro(request.url, request.headers), maxAge: 0 });

export const redirecionar = (destino: string, cookie?: string) =>
  new Response(null, { status: 303, headers: { Location: destino, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
