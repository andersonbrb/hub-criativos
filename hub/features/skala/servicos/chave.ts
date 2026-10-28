import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { VARIAVEL_DA_CHAVE } from "@/features/skala/contrato";

// A chave fixa combinada entre o servidor do Skala e o hub, de antes das chaves de API (features/api). Fica só na
// variável do serviço no Railway (as duas pontas leem de lá), nunca no código nem no banco, e continua valendo do
// mesmo jeito: o que ela manda entra na Grupo Chegou.
//
// Chave curta demais conta como ausente: com menos de 32 caracteres dá para adivinhar.
export const TAMANHO_MINIMO_DA_CHAVE = 32;

export function chaveConfigurada(): string | null {
  const chave = process.env[VARIAVEL_DA_CHAVE]?.trim() ?? "";
  return chave.length >= TAMANHO_MINIMO_DA_CHAVE ? chave : null;
}

// O que vem em "Authorization: Bearer <chave>".
export const chaveDoCabecalho = (request: Request): string | null =>
  /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization")?.trim() ?? "")?.[1]?.trim() || null;

// Compara os SHA-256 em tempo constante: a resposta não entrega, pela demora, quantas letras do começo acertaram.
export function ehAChaveFixa(recebida: string | null): boolean {
  const esperada = chaveConfigurada();
  if (!esperada || !recebida) return false;
  const a = createHash("sha256").update(recebida, "utf8").digest();
  const b = createHash("sha256").update(esperada, "utf8").digest();
  return timingSafeEqual(a, b);
}
