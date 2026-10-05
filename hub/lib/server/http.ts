import "server-only";

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

// Envolve um route handler e devolve erros como { error } em JSON, legíveis na interface.
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      const status = err instanceof MissingKeyError || err instanceof InputError ? 400 : 502;
      const message = err instanceof Error ? err.message : "Erro inesperado";
      console.error("[hub]", message);
      return Response.json({ error: message }, { status });
    }
  };
}
