import Anthropic from '@anthropic-ai/sdk';
import { fetchApifyAccount } from './apify-account';

/** Credencial recusada ou serviço fora do ar: a mensagem vai para o painel. */
export class IntegrationCheckError extends Error {}

export interface ProviderAccount {
  /** Conta conectada, para mostrar no painel. */
  account: string | null;
  usage?: { usedUsd: number; limitUsd: number; cycleEndsAt: string } | null;
}

type Fetch = typeof fetch;

async function getJson(
  fetchFn: Fetch,
  url: string,
  headers: Record<string, string>,
  service: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new IntegrationCheckError(`Sem resposta do ${service}. Tente de novo.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationCheckError(`O ${service} recusou a chave. Confira se ela está correta.`);
  }
  if (!response.ok) throw new IntegrationCheckError(`O ${service} respondeu ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

export async function checkApify(token: string, fetchFn: Fetch = fetch): Promise<ProviderAccount> {
  try {
    const account = await fetchApifyAccount(token, fetchFn);
    return {
      account: account.username || null,
      usage: {
        usedUsd: account.usedUsd,
        limitUsd: account.limitUsd,
        cycleEndsAt: account.cycleEndsAt,
      },
    };
  } catch (error) {
    throw new IntegrationCheckError(
      error instanceof Error ? error.message : 'Falha ao verificar o Apify.',
    );
  }
}

/** Lista um modelo: valida a chave sem gastar tokens. */
export async function checkAnthropic(apiKey: string): Promise<ProviderAccount> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 });
  try {
    await client.models.list({ limit: 1 });
    return { account: `chave …${apiKey.slice(-4)}` };
  } catch (error) {
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      throw new IntegrationCheckError('A Anthropic recusou a chave. Confira se ela está correta.');
    }
    if (error instanceof Anthropic.APIError) {
      throw new IntegrationCheckError(`A Anthropic respondeu ${error.status ?? 'com erro'}.`);
    }
    throw new IntegrationCheckError('Sem resposta da Anthropic. Tente de novo.');
  }
}

export async function checkElevenLabs(
  apiKey: string,
  fetchFn: Fetch = fetch,
): Promise<ProviderAccount> {
  const data = await getJson(
    fetchFn,
    'https://api.elevenlabs.io/v1/user/subscription',
    { 'xi-api-key': apiKey },
    'ElevenLabs',
  );
  const tier = typeof data['tier'] === 'string' ? data['tier'] : null;
  const used = Number(data['character_count'] ?? NaN);
  const limit = Number(data['character_limit'] ?? NaN);
  const chars =
    Number.isFinite(used) && Number.isFinite(limit)
      ? ` · ${used.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')} caracteres`
      : '';
  return { account: tier ? `plano ${tier}${chars}` : null };
}

export async function checkHeyGen(
  apiKey: string,
  fetchFn: Fetch = fetch,
): Promise<ProviderAccount> {
  const body = await getJson(
    fetchFn,
    'https://api.heygen.com/v3/users/me',
    { 'x-api-key': apiKey },
    'HeyGen',
  );
  const data = (body['data'] ?? {}) as Record<string, unknown>;
  const username = typeof data['username'] === 'string' ? data['username'] : null;
  const email = typeof data['email'] === 'string' ? data['email'] : null;
  return { account: username ?? email };
}

export async function checkFlora(apiKey: string, fetchFn: Fetch = fetch): Promise<ProviderAccount> {
  const body = await getJson(
    fetchFn,
    'https://app.flora.ai/api/v1/workspaces',
    { authorization: `Bearer ${apiKey}` },
    'FLORA',
  );
  const list = Array.isArray(body['data']) ? body['data'] : Array.isArray(body) ? body : [];
  const first = (list[0] ?? {}) as Record<string, unknown>;
  const name = typeof first['name'] === 'string' ? first['name'] : null;
  return { account: name ? `workspace ${name}` : null };
}
