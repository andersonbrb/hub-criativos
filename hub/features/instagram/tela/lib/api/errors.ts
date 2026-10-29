import { ApiErrorSchema } from '@sbs/contracts';

/** Códigos gerados pelo próprio cliente (não vêm da API). */
export const CLIENT_ERROR_CODES = {
  network: 'network_error',
  invalidResponse: 'invalid_response',
  invalidInput: 'invalid_input',
} as const;

/** Erro tipado de qualquer chamada à API. A UI só lida com esta classe. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  /** Mapeia o corpo de uma resposta de erro (`ApiErrorSchema`) ou cai num erro genérico pelo status. */
  static fromResponseBody(status: number, body: unknown): ApiError {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      return new ApiError(parsed.data.code, parsed.data.message, status, parsed.data.details);
    }
    // Recusa do próprio hub (login, tela sem acesso, organização trocada): { error } com a frase pronta.
    const hub = (body as { error?: unknown } | null)?.error;
    if (typeof hub === 'string' && hub) return new ApiError(`http_${status}`, hub, status);
    return new ApiError(`http_${status}`, fallbackMessageForStatus(status), status);
  }

  static network(cause: unknown): ApiError {
    const error = new ApiError(
      CLIENT_ERROR_CODES.network,
      'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
      null,
    );
    error.cause = cause;
    return error;
  }

  static invalidResponse(route: string, issues: string): ApiError {
    return new ApiError(
      CLIENT_ERROR_CODES.invalidResponse,
      'O servidor respondeu num formato inesperado.',
      null,
      { route, issues },
    );
  }

  /** Erros de campo enviados pela API em `details.fieldErrors` (quando houver). */
  get fieldErrors(): Record<string, string> {
    const raw = this.details?.['fieldErrors'];
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') result[key] = value;
      else if (Array.isArray(value) && typeof value[0] === 'string') result[key] = value[0];
    }
    return result;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function fallbackMessageForStatus(status: number): string {
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  if (status === 404) return 'Não encontramos o que você procurava.';
  if (status === 409) return 'Alguém alterou este item ao mesmo tempo. Recarregue e tente de novo.';
  if (status >= 500) return 'O servidor encontrou um problema. Tente de novo em instantes.';
  return 'Não foi possível concluir a ação.';
}

/** Mensagem legível para qualquer erro (para toasts e estados de erro). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Algo deu errado.';
}
