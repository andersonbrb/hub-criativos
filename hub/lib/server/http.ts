import "server-only";

import { NaoAutenticado, SemPermissao, type Chave } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
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

export type OpcoesDaRota = {
  // Chave da tela exigida (features/acesso/contrato.ts). Sem ela, basta estar logado.
  chave?: Chave;
  // Rota aberta, sem login (ex.: entrar, saúde, aceitar convite). Use só quando a rota tem a própria proteção.
  publica?: boolean;
};

// Envolve um route handler: exige login (e a chave, se pedida) e devolve erros como { error } em JSON,
// legíveis na interface. Quem precisa da pessoa logada dentro do handler chama exigirUsuario() de novo.
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>, opcoes: OpcoesDaRota = {}) {
  return async (...args: A): Promise<Response> => {
    try {
      if (!opcoes.publica) await exigirUsuario(opcoes.chave);
      return await fn(...args);
    } catch (err) {
      const status =
        err instanceof NaoAutenticado ? 401 : err instanceof SemPermissao ? 403 : err instanceof MissingKeyError || err instanceof InputError ? 400 : 502;
      const message = err instanceof Error ? err.message : "Erro inesperado";
      console.error("[hub]", message);
      return Response.json({ error: message }, { status });
    }
  };
}
