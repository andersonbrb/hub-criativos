import type { IntegrationStatus, SyncResult } from '@sbs/contracts';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NomeDaChave } from '@/features/integracoes/contrato';

import { createContainer, type Container } from '../composition/container';
import { seedDemoData } from '../composition/seed-demo';
import { buildServer, type Server } from '../http/server';
import { asUser, openTestDatabase, testPlatform } from './test-env';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Conta que "fez login" no Instagram simulado. */
let instagramProfile = { username: 'momentodeoracionsb', userId: '1784' };

/** Serviços externos simulados, roteados pela URL. */
const externalFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  if (url.startsWith('https://api.apify.com/v2/users/me/limits')) {
    return json({
      data: {
        monthlyUsageCycle: { endAt: '2026-11-18T23:59:59.999Z' },
        limits: { maxMonthlyUsageUsd: 5 },
        current: { monthlyUsageUsd: 0.14 },
      },
    });
  }
  if (url.startsWith('https://api.apify.com/v2/users/me')) {
    return auth === 'Bearer apify-ok' ? json({ data: { username: 'chegou' } }) : json({}, 401);
  }
  if (url.includes('apify~instagram-scraper')) {
    return json(
      [
        {
          id: 'ig-1',
          type: 'Video',
          url: 'https://www.instagram.com/reel/IG1/',
          caption: 'Post real',
          displayUrl: 'https://scontent.cdninstagram.com/ig1.jpg',
          videoUrl: 'https://scontent.cdninstagram.com/ig1.mp4',
          timestamp: '2026-10-10T12:00:00.000Z',
          likesCount: 10,
          commentsCount: 2,
          ownerUsername: 'santaespiritualidade',
        },
      ],
      201,
    );
  }
  if (url.startsWith('https://api.elevenlabs.io/')) return json({}, 401);
  if (url.startsWith('https://app.flora.ai/api/v1/') && auth !== 'Bearer ak_ok')
    return json({}, 401);
  if (url.startsWith('https://app.flora.ai/api/v1/workspaces')) {
    return json({ workspaces: [{ workspace_id: 'ws_1', name: 'Chegou', role: 'admin' }] });
  }
  if (url.startsWith('https://app.flora.ai/api/v1/models')) {
    return json({
      featured: [],
      models: [
        { model_id: 't2i-x', name: 'Só texto', capabilities: ['text-to-image'] },
        {
          model_id: 'i2i-elote-gateway',
          name: 'Nano Banana 2.1',
          capabilities: ['image-to-image'],
          estimated_cost_usd: 0.0522,
          estimated_seconds: 40,
        },
      ],
    });
  }
  if (url.startsWith('https://api.instagram.com/oauth/access_token')) {
    return json({ data: [{ access_token: 'short', user_id: '1784', permissions: '' }] });
  }
  if (url.startsWith('https://graph.instagram.com/access_token')) {
    return json({ access_token: 'long-token', token_type: 'bearer', expires_in: 5_184_000 });
  }
  if (url.startsWith('https://graph.instagram.com/v23.0/me')) {
    return json({ user_id: instagramProfile.userId, username: instagramProfile.username });
  }
  return json({ error: `não simulado: ${url}` }, 500);
});

describe('central de integrações no hub (API + banco)', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;
  let server: Server;
  // As chaves coladas na tela Integrações do hub e os logins das contas (MCP), trocados entre os casos.
  const keys: Partial<Record<NomeDaChave, string>> = {};
  const mcp: Partial<Record<'heygen' | 'elevenlabs' | 'flora', boolean>> = {};

  const call = async <T>(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    body?: unknown,
    role = 'admin',
  ) => {
    const res = await server.inject({
      method,
      url,
      headers: asUser(role),
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    return { status: res.statusCode, body: res.json() as T, raw: res };
  };
  const list = async () => (await call<IntegrationStatus[]>('GET', '/integrations')).body;
  const find = async (id: string) => (await list()).find((i) => i.id === id)!;

  beforeAll(async () => {
    process.env.HUB_CHAVE_SEGREDOS = Buffer.alloc(32, 7).toString('base64');
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock: new FixedClock('2026-10-19T12:00:00.000Z'),
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform({ production: true, keys, mcp, fetch: externalFetch as unknown as typeof fetch }),
    });
    server = await buildServer(container);
    await seedDemoData(container, { runPipeline: false });
  }, 60_000);

  afterAll(async () => {
    container.jobs.close();
    await server.close();
    await handle.close();
  });

  it('lista todas as integrações; sem nada no hub, nada conectado', async () => {
    const all = await list();
    expect(all.map((i) => [i.id, i.status, i.configurable])).toEqual([
      ['apify', 'disconnected', false],
      ['anthropic', 'disconnected', false],
      ['vmake', 'disconnected', false],
      ['elevenlabs', 'disconnected', false],
      ['heygen', 'disconnected', false],
      ['flora', 'disconnected', false],
      ['instagram', 'disconnected', false],
      ['creative', 'disconnected', false],
    ]);
    // Produção sem Apify: a sincronização avisa, não inventa posts.
    const sync = await call<{ code: string }>('POST', '/reference/sync');
    expect(sync.body.code).toBe('reference_feed_not_configured');
  });

  it('as chaves se conectam na tela Integrações do hub, não aqui', async () => {
    const res = await call<{ code: string }>('PUT', '/integrations/apify', { values: { token: 'apify-ok' } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('integration_in_hub');
    expect((await call('PUT', '/integrations/apify', { values: { token: 'x' } }, 'reviewer')).status).toBe(403);
  });

  it('o token do Apify colado no hub vale na hora, com o consumo do mês', async () => {
    keys.apify = 'apify-ok';
    expect(await find('apify')).toMatchObject({
      status: 'connected',
      source: 'panel',
      account: 'chegou',
      usage: { usedUsd: 0.14, limitUsd: 5 },
    });
    const sync = await call<SyncResult>('POST', '/reference/sync');
    expect(sync.body).toMatchObject({ sources: 1, imported: 1 });
  });

  it('HeyGen, ElevenLabs e FLORA seguem o login das contas no hub', async () => {
    const before = await call<{ connected: boolean; models: unknown[] }>('GET', '/integrations/flora/models');
    expect(before.body).toMatchObject({ connected: false, models: [] });
    mcp.flora = true;
    mcp.heygen = true;
    expect((await find('heygen')).status).toBe('connected');
    expect((await find('elevenlabs')).status).toBe('disconnected');
    const after = await call<{ connected: boolean; defaultModel: string; models: { id: string }[] }>(
      'GET',
      '/integrations/flora/models',
      undefined,
      'reviewer',
    );
    expect(after.body.connected).toBe(true);
    expect(after.body.defaultModel).toBe('i2i-elote-gateway');
    expect(after.body.models[0]?.id).toBe('i2i-elote-gateway');
    expect(after.body.models.length).toBeGreaterThan(1);
  });

  it('tirar a chave no hub volta ao estado sem credencial', async () => {
    delete keys.apify;
    expect((await find('apify')).status).toBe('disconnected');
  });

  it('Instagram: conectar conta para um mercado; o @ vem do login e o mercado é editável', async () => {
    const markets = (await call<{ id: string; code: string }[]>('GET', '/markets')).body;
    const es = markets.find((m) => m.code === 'es-latam')!;
    const fr = markets.find((m) => m.code === 'fr')!;

    const noApp = await call<{ code: string }>('POST', '/integrations/instagram/authorize', {
      origin: 'https://painel.example.com',
      marketId: es.id,
    });
    expect(noApp.body.code).toBe('instagram_app_not_connected');

    keys['instagram-app-id'] = '990602627938098';
    keys['instagram-app-secret'] = 'segredo-do-app-123456';
    expect(await find('instagram')).toMatchObject({ status: 'connected', publicValues: { appId: '990602627938098' } });

    const login = async (marketId: string, username: string, userId: string) => {
      instagramProfile = { username, userId };
      const start = await call<{ url: string }>('POST', '/integrations/instagram/authorize', {
        origin: 'https://painel.example.com/instagram/configuracoes',
        marketId,
      });
      const authorize = new URL(start.body.url);
      // O retorno é sempre o endereço público do hub, o que fica cadastrado no app da Meta.
      expect(authorize.searchParams.get('redirect_uri')).toBe(
        'http://hub.test/api/instagram/integrations/instagram/callback',
      );
      const state = authorize.searchParams.get('state')!;
      return server.inject({
        method: 'GET',
        url: `/integrations/instagram/callback?code=abc%23_&state=${state}`,
      });
    };

    // Espanhol: conta com o mesmo @ do canal provisório → vinculada.
    const esBack = await login(es.id, 'momentodeoracionsb', '1784');
    expect(esBack.headers['content-type']).toContain('text/html');
    expect(esBack.body).toContain('resultado=ok');
    expect(esBack.body).toContain('/instagram/configuracoes');

    // Francês: o @ real vem do Instagram e substitui o provisório do mercado.
    const frBack = await login(fr.id, 'MomentDePriere.FR', '2001');
    expect(frBack.body).toContain('conta=momentdepriere.fr');

    let channels = (await find('instagram')).channels!;
    expect(channels.map((c) => [c.handle, c.marketId, c.status]).sort()).toEqual(
      [
        ['momentdepriere.fr', fr.id, 'connected'],
        ['momentodeoracionsb', es.id, 'connected'],
      ].sort(),
    );

    // O token fica cifrado com a chave de segredos do hub.
    const { instagramDocumentos } = await import('@/db/schema');
    const stored = (await handle.db().select({ dados: instagramDocumentos.dados }).from(instagramDocumentos))
      .map((r) => JSON.stringify(r.dados))
      .join(' ');
    expect(stored).not.toContain('long-token');

    // Trocar o mercado da conta.
    const frChannel = channels.find((c) => c.handle === 'momentdepriere.fr')!;
    const moved = await call<IntegrationStatus>(
      'PUT',
      `/integrations/instagram/channels/${frChannel.channelId}/market`,
      { marketId: es.id },
    );
    expect(moved.body.channels!.find((c) => c.channelId === frChannel.channelId)?.marketId).toBe(
      es.id,
    );
    const denied = await call(
      'PUT',
      `/integrations/instagram/channels/${frChannel.channelId}/market`,
      { marketId: fr.id },
      'reviewer',
    );
    expect(denied.status).toBe(403);

    // Publicação real: começa desligada; só o admin liga; reconectar não desliga.
    expect(frChannel.publishing).toBe(false);
    const publishingPath = `/integrations/instagram/channels/${frChannel.channelId}/publishing`;
    expect((await call('PUT', publishingPath, { enabled: true }, 'reviewer')).status).toBe(403);
    const on = await call<IntegrationStatus>('PUT', publishingPath, { enabled: true });
    expect(on.body.channels!.find((c) => c.channelId === frChannel.channelId)?.publishing).toBe(
      true,
    );
    const access = await container.integrations.instagramPublishing(frChannel.channelId);
    expect(access).toEqual({ userId: '2001', accessToken: 'long-token', enabled: true });

    // Reconectar a mesma conta não duplica o canal.
    await login(fr.id, 'momentdepriere.fr', '2001');
    channels = (await find('instagram')).channels!;
    expect(channels).toHaveLength(2);
    expect(channels.find((c) => c.handle === 'momentdepriere.fr')?.publishing).toBe(true);
    expect(channels.find((c) => c.handle === 'momentdepriere.fr')?.marketId).toBe(fr.id);

    // Estado desconhecido (login não iniciado aqui): recusado.
    const forged = await server.inject({
      method: 'GET',
      url: `/integrations/instagram/callback?code=abc&state=forjado`,
    });
    expect(forged.body).toContain('resultado=erro');
  });
});
