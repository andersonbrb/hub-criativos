import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { VARIAVEL_DA_CHAVE } from "@/features/skala/contrato";

// A chave combinada entre o servidor do Skala e o hub. Fica só na variável do serviço no Railway (as duas pontas leem
// de lá), nunca no código nem no banco. É uma senha entre dois sistemas, não a chave de um serviço que alguém cola
// na tela Integrações: por isso é variável.
//
// Chave curta demais conta como ausente: com menos de 32 caracteres dá para adivinhar, e a conexão fica desligada.
export const TAMANHO_MINIMO_DA_CHAVE = 32;

export function chaveConfigurada(): string | null {
  const chave = process.env[VARIAVEL_DA_CHAVE]?.trim() ?? "";
  return chave.length >= TAMANHO_MINIMO_DA_CHAVE ? chave : null;
}

// "Authorization: Bearer <chave>". Compara os SHA-256 em tempo constante: a resposta não entrega, pela demora,
// quantas letras do começo acertaram.
export function chaveDoPedidoConfere(request: Request): boolean {
  const esperada = chaveConfigurada();
  const recebida = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization")?.trim() ?? "")?.[1]?.trim();
  if (!esperada || !recebida) return false;
  const a = createHash("sha256").update(recebida, "utf8").digest();
  const b = createHash("sha256").update(esperada, "utf8").digest();
  return timingSafeEqual(a, b);
}
