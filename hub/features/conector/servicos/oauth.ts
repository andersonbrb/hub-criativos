import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { metaDoPedido } from "@/features/acesso/servicos/pedido";
import type { App } from "@/features/conector/contrato";
import { ESCOPO_HUB, ESCOPO_OFFLINE, redirectsPermitidos } from "@/features/conector/servicos/config";

// As regras do OAuth que não dependem de banco: retorno, PKCE, recurso e escopo.
//
// A TRAVA DE CONFIANÇA É O ENDEREÇO DE RETORNO. O registro de cliente é público: qualquer um registra. O que impede
// um site qualquer de pedir "Conectar" e receber o código de alguém é que o código só volta para:
//   • os endereços do Claude na web (MCP_REDIRECTS_PERMITIDOS, comparação exata); ou
//   • o loopback do Claude Code: http://localhost:<porta>/callback ou http://127.0.0.1:<porta>/callback. A porta
//     muda a cada login (o Claude Code abre um servidor local numa porta livre), então ela é ignorada na comparação,
//     como manda a RFC 8252 §7.3. O código que volta para o loopback só é lido por um programa na máquina da pessoa.
// Qualquer outro endereço é recusado NO REGISTRO, antes de o cliente existir, e de novo no authorize.
//
// PKCE É OBRIGATÓRIO E SÓ S256: cliente público não tem segredo, e é o PKCE que prova que quem troca o código é
// quem começou o fluxo.

// Texto cru, e não URL interpretada: o parser normaliza caminho ("/./callback") e aceitaria variações que o Claude
// Code nunca manda. Sem usuário, query nem fragmento.
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(?::(\d{1,5}))?\/callback$/;

// RFC 7636 §4.1: 43 a 128 caracteres "unreserved".
const PKCE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function ehLoopback(uri: unknown): boolean {
  const m = typeof uri === "string" ? LOOPBACK.exec(uri) : null;
  return Boolean(m) && (m![2] === undefined || Number(m![2]) <= 65535);
}

export function redirectPermitido(uri: unknown): boolean {
  if (typeof uri !== "string" || !uri || uri.length > 500) return false;
  return redirectsPermitidos().includes(uri) || ehLoopback(uri);
}

// O redirect_uri do pedido é o registrado? No loopback a porta não conta, mas o host conta (localhost ≠ 127.0.0.1).
export function redirectConfere(registrado: string, pedido: string): boolean {
  if (registrado === pedido) return true;
  if (!ehLoopback(registrado) || !ehLoopback(pedido)) return false;
  return LOOPBACK.exec(registrado)![1] === LOOPBACK.exec(pedido)![1];
}

export const appDoRedirect = (uri: string): App => (ehLoopback(uri) ? "claude_code" : "claude");

export const pkceValido = (valor: unknown) => typeof valor === "string" && PKCE.test(valor);

// BASE64URL(SHA256(verificador)) sem padding, comparado em tempo constante.
export function pkceConfere(verificador: unknown, desafio: string): boolean {
  if (!pkceValido(verificador) || !desafio) return false;
  const calculado = Buffer.from(createHash("sha256").update(String(verificador), "ascii").digest("base64url"));
  const esperado = Buffer.from(desafio);
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

// Caixa do esquema e do host não importa; barra no fim também não.
function normalizarRecurso(valor: unknown): string {
  if (typeof valor !== "string") return "";
  try {
    const u = new URL(valor);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return "";
  }
}

export function recursoConfere(valor: unknown, esperado: string): boolean {
  const normal = normalizarRecurso(valor);
  return Boolean(normal) && normal === normalizarRecurso(esperado);
}

// Escopo desconhecido é IGNORADO, não recusado (a RFC 6749 §3.3 deixa conceder menos que o pedido): o Claude pode
// mandar escopos genéricos, e recusar por isso travaria a conexão sem proteger nada.
export function normalizarEscopos(texto: unknown): string[] {
  const pedidos = typeof texto === "string" ? texto.split(/\s+/) : [];
  return pedidos.includes(ESCOPO_OFFLINE) ? [ESCOPO_HUB, ESCOPO_OFFLINE] : [ESCOPO_HUB];
}

// O endereço com os parâmetros somados à query que ele já tiver (nulos ficam de fora).
export function comParametros(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri);
  for (const [chave, valor] of Object.entries(params)) if (valor !== null && valor !== undefined) u.searchParams.append(chave, valor);
  return u.toString();
}

// O que a tela mostra como destino: "claude.ai", "localhost:33418"…
export function hostDoDestino(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "";
  }
}

// IP de quem chamou, pelo mesmo critério das rotas de login (features/acesso/servicos/pedido.ts): o x-real-ip que o
// proxy do Railway grava e, sem ele, o ÚLTIMO item do X-Forwarded-For (o que o proxy acrescentou). Os itens da
// esquerda vêm de quem chamou e podem ser inventados: contar por eles deixaria um só atacante fingir 500 IPs e
// estourar o teto global de registros, travando o /oauth2/register de todo mundo.
// Serve para registro e para os tetos de enxurrada, nunca para permissão (essa é sempre o token e as chaves da conta).
export function ipDaRequisicao(request: Request): string | null {
  const { ip } = metaDoPedido(request);
  return ip && isIP(ip) ? ip : null;
}
