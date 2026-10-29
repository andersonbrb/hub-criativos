import { IntegrationCheckError } from './provider-checks';

/**
 * Login oficial do Instagram (Instagram API with Instagram Login). Escopos: perfil básico e
 * publicação de conteúdo. O token longo dura 60 dias e pode ser renovado.
 */
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const GRAPH_VERSION = 'v23.0';

type Fetch = typeof fetch;

export interface InstagramApp {
  appId: string;
  appSecret: string;
}

export interface InstagramToken {
  accessToken: string;
  userId: string;
  username: string;
  expiresAt: string;
}

export function instagramAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

async function readJson(response: Response, step: string): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body['error'] as { message?: string } | string | undefined;
    const detail =
      (typeof error === 'object' ? error?.message : undefined) ??
      (typeof body['error_message'] === 'string' ? body['error_message'] : undefined) ??
      `status ${response.status}`;
    throw new IntegrationCheckError(`O Instagram recusou ${step}: ${detail}`);
  }
  return body;
}

/** Código do retorno → token longo (60 dias) + @ da conta. */
export async function exchangeInstagramCode(
  app: InstagramApp,
  code: string,
  redirectUri: string,
  now: Date,
  fetchFn: Fetch = fetch,
): Promise<InstagramToken> {
  const short = await readJson(
    await fetchFn('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: app.appId,
        client_secret: app.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        // O Instagram acrescenta "#_" ao final do código no retorno.
        code: code.replace(/#_$/, ''),
      }),
    }),
    'o código de autorização',
  );
  const first = (Array.isArray(short['data']) ? short['data'][0] : short) as Record<
    string,
    unknown
  >;
  const shortToken = String(first?.['access_token'] ?? '');
  if (!shortToken) throw new IntegrationCheckError('O Instagram não devolveu o token de acesso.');

  const long = await readJson(
    await fetchFn(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: app.appSecret,
        access_token: shortToken,
      }).toString()}`,
    ),
    'a troca pelo token de longa duração',
  );
  const accessToken = String(long['access_token'] ?? '');
  const expiresIn = Number(long['expires_in'] ?? 5_184_000);

  const me = await readJson(
    await fetchFn(
      `https://graph.instagram.com/${GRAPH_VERSION}/me?${new URLSearchParams({
        fields: 'user_id,username',
        access_token: accessToken,
      }).toString()}`,
    ),
    'a leitura do perfil',
  );
  return {
    accessToken,
    userId: String(me['user_id'] ?? me['id'] ?? first?.['user_id'] ?? ''),
    username: String(me['username'] ?? ''),
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
  };
}
