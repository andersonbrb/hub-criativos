import "server-only";

export const KEYS = {
  elevenlabs: "ELEVENLABS_API_KEY",
  heygen: "HEYGEN_API_KEY",
  flora: "FLORA_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  venice: "VENICE_API_KEY", // Modo Black do chat principal
} as const;

export type Provider = keyof typeof KEYS;

export class MissingKeyError extends Error {
  constructor(public provider: Provider) {
    super(`Falta a chave ${KEYS[provider]} no arquivo hub/.env.local. Adicione a chave e reinicie o servidor (npm run dev).`);
  }
}

export function requireKey(provider: Provider): string {
  const value = process.env[KEYS[provider]]?.trim();
  if (!value) throw new MissingKeyError(provider);
  return value;
}

export function hasKey(provider: Provider): boolean {
  return Boolean(process.env[KEYS[provider]]?.trim());
}
