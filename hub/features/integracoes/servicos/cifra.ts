import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Cifra dos segredos guardados no banco (tokens do Google Drive e chaves das integrações): AES-256-GCM com a chave
// HUB_CHAVE_SEGREDOS, que fica só nas variáveis do servidor. Formato: v1.<iv>.<etiqueta>.<cifrado>, em base64url.
// O GCM confere a etiqueta ao abrir: um valor adulterado no banco não decifra, em vez de virar um token errado.

const VERSAO_DA_CIFRA = "v1";

// O que está errado com a HUB_CHAVE_SEGREDOS (texto para a tela), ou null quando ela serve.
export function problemaNaChave(): string | null {
  const bruta = process.env.HUB_CHAVE_SEGREDOS?.trim();
  if (!bruta) return "Falta HUB_CHAVE_SEGREDOS nas variáveis do servidor: sem ela o hub não guarda as chaves das integrações nem a autorização do Google com segurança.";
  if (Buffer.from(bruta, "base64").length !== 32)
    return "HUB_CHAVE_SEGREDOS precisa ter 32 bytes em base64 (44 caracteres, terminando em \"=\"). Gere uma como explica docs/google-drive.md.";
  return null;
}

function chaveDosSegredos(): Buffer {
  const problema = problemaNaChave();
  if (problema) throw new Error(problema);
  return Buffer.from(process.env.HUB_CHAVE_SEGREDOS!.trim(), "base64");
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveDosSegredos(), iv);
  const corpo = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return [VERSAO_DA_CIFRA, iv.toString("base64url"), cifra.getAuthTag().toString("base64url"), corpo.toString("base64url")].join(".");
}

export function decifrar(cifrado: string): string {
  const chave = chaveDosSegredos();
  const [versao, iv, etiqueta, corpo, ...resto] = cifrado.split(".");
  try {
    if (versao !== VERSAO_DA_CIFRA || !iv || !etiqueta || corpo === undefined || resto.length) throw new Error("formato");
    // authTagLength fixo: sem ele o Node aceitaria uma etiqueta encurtada, mais fácil de forjar.
    const decifra = createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64url"), { authTagLength: 16 });
    decifra.setAuthTag(Buffer.from(etiqueta, "base64url"));
    return Buffer.concat([decifra.update(Buffer.from(corpo, "base64url")), decifra.final()]).toString("utf8");
  } catch {
    throw new Error("Não deu para abrir um segredo guardado no banco: a chave HUB_CHAVE_SEGREDOS não é a mesma de quando ele foi gravado.");
  }
}
