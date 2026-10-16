import "server-only";

import { lerChave } from "@/features/integracoes/servicos/chaves";

// Chaves de API que o hub usa. Ficam na tela Integrações (features/integracoes), não em variáveis do servidor.
// HeyGen, FLORA, ElevenLabs e Higgsfield não estão aqui: entram pelo login da conta (MCP).
export const KEYS = {
  anthropic: { nome: "Claude", cartao: "Claude" },
  venice: { nome: "Venice", cartao: "Venice" }, // Modo Black do chat principal
} as const;

export type Provider = keyof typeof KEYS;

export class MissingKeyError extends Error {
  constructor(public provider: Provider) {
    super(`Falta a chave da API do ${KEYS[provider].nome}. Um admin cola em Integrações → ${KEYS[provider].cartao}.`);
  }
}

export async function requireKey(provider: Provider): Promise<string> {
  const value = await lerChave(provider);
  if (!value) throw new MissingKeyError(provider);
  return value;
}

export async function hasKey(provider: Provider): Promise<boolean> {
  return Boolean(await lerChave(provider));
}
