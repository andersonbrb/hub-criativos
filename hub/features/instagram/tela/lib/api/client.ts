import { buildPath, routes, type RouteName } from '@sbs/contracts';
import type { z } from 'zod';
import { ApiError } from './errors';

/**
 * As telas chamam as rotas do Instagram no próprio hub (`/api/instagram`), atrás do login e da tela Instagram
 * (app/api/instagram/[...caminho]).
 */
export const DEFAULT_API_URL = '/api/instagram';

export function apiBaseUrl(): string {
  return DEFAULT_API_URL;
}

/** Organização que esta tela carregou: se outra aba trocou, o hub responde 409 e a tela recarrega (lib/generations.ts). */
function organizationHeader(): Record<string, string> {
  const org = typeof document === 'undefined' ? undefined : document.documentElement.dataset['organizacao'];
  return org ? { 'x-hub-organizacao': org } : {};
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<S extends z.ZodType> {
  /** Parâmetros `:param` do caminho. */
  params?: Record<string, string>;
  /** Query string; valores `undefined`/`null`/'' são omitidos. */
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Esquema do contrato que valida a resposta. */
  schema: S;
  signal?: AbortSignal;
}

export function buildUrl(
  route: RouteName,
  params?: Record<string, string>,
  query?: Record<string, QueryValue>,
): string {
  // Base relativa (`/api`) precisa de uma origem para virar URL absoluta.
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(apiBaseUrl() + buildPath(routes[route].path, params), origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Chama uma rota do catálogo `routes`, valida a resposta com o esquema do contrato
 * e converte qualquer falha em `ApiError`.
 */
export async function request<S extends z.ZodType>(
  route: RouteName,
  options: RequestOptions<S>,
): Promise<z.output<S>> {
  const { method } = routes[route];
  const url = buildUrl(route, options.params, options.query);
  const hasBody = options.body !== undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...organizationHeader(),
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw ApiError.network(cause);
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const codigo = (payload as { codigo?: string } | undefined)?.codigo;
    if (response.status === 409 && codigo === 'organizacao_trocada' && typeof window !== 'undefined') {
      window.location.reload();
    }
    throw ApiError.fromResponseBody(response.status, payload);
  }

  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('; ');
    throw ApiError.invalidResponse(route, issues);
  }
  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
