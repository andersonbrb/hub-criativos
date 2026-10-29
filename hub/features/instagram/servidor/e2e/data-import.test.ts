import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createContainer, type Container } from '../composition/container';
import { buildServer, type Server } from '../http/server';
import { asUser, openTestDatabase, testPlatform } from './test-env';

/** O que o projeto de origem tinha no banco de produção (formato da tabela `aggregates`). */
const market = {
  type: 'markets.market',
  id: '3392c5ab-c12f-41ef-9b95-9ca14d82e8fc',
  version: 1,
  createdAt: '2026-10-23T18:02:16.442Z',
  updatedAt: '2026-10-23T18:02:16.442Z',
  data: {
    id: '3392c5ab-c12f-41ef-9b95-9ca14d82e8fc',
    code: 'es-latam',
    name: 'América Latina',
    locale: 'es-419',
    status: 'active',
    version: 1,
    glossary: [{ source: 'São Bento', target: 'San Benito' }],
    offerUrl: 'https://sanbenito.example.com/es',
    timezone: 'America/Mexico_City',
    createdAt: '2026-10-23T18:02:16.405Z',
    productName: 'San Benito',
    forbiddenTerms: ['Sagrado Verso'],
  },
};
const channel = {
  type: 'markets.channel',
  id: 'c474d8a9-a18b-451c-976f-9fb061ab5ae1',
  version: 1,
  createdAt: '2026-10-23T18:02:16.540Z',
  updatedAt: '2026-10-23T18:02:16.540Z',
  data: {
    id: 'c474d8a9-a18b-451c-976f-9fb061ab5ae1',
    handle: 'momentodeoracionsb',
    version: 1,
    marketId: market.id,
    platform: 'instagram',
    displayName: 'Momento de Oración | San Benito',
    postingPlan: [{ format: 'reel', localTime: '10:00' }],
    connectionStatus: 'disconnected',
    externalAccountId: null,
  },
};
const secret = {
  type: 'platform.integration',
  id: 'apify',
  version: 1,
  createdAt: '2026-10-27T18:56:07.858Z',
  updatedAt: '2026-10-27T18:56:07.858Z',
  data: { id: 'apify', sealed: 'v1.x.y.z', publicValues: {} },
};
const events = [
  { type: 'markets.market_created', occurredAt: '2026-10-23T18:02:16.405Z', payload: { marketId: market.id } },
];

describe('importação dos dados do projeto de origem', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;
  let server: Server;

  beforeAll(async () => {
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock: new FixedClock('2026-10-29T12:00:00.000Z'),
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform(),
    });
    server = await buildServer(container);
  }, 60_000);

  afterAll(async () => {
    container.jobs.close();
    await server.close();
    await handle.close();
  });

  const importar = (role: string) =>
    server.inject({
      method: 'POST',
      url: '/admin/import',
      headers: asUser(role),
      payload: { documents: [market, channel, secret], events },
    });

  it('só o admin importa', async () => {
    expect((await importar('reviewer')).statusCode).toBe(403);
  });

  it('traz mercados e contas com os mesmos ids; credenciais ficam de fora; rodar de novo não duplica', async () => {
    const first = await importar('admin');
    expect(first.json()).toEqual({ documents: 2, skippedDocuments: 1, events: 1 });

    const markets = (await server.inject({ method: 'GET', url: '/markets', headers: asUser('reviewer') })).json();
    expect(markets).toEqual([expect.objectContaining({ id: market.id, code: 'es-latam', productName: 'San Benito' })]);
    const channels = (await server.inject({ method: 'GET', url: '/channels', headers: asUser('reviewer') })).json();
    expect(channels).toEqual([expect.objectContaining({ id: channel.id, handle: 'momentodeoracionsb', marketId: market.id })]);

    const again = await importar('admin');
    expect(again.json()).toEqual({ documents: 0, skippedDocuments: 3, events: 0 });

    // O mercado importado continua editável (a versão segue a do projeto de origem).
    const updated = await server.inject({
      method: 'PATCH',
      url: `/markets/${market.id}`,
      headers: asUser('admin'),
      payload: { offerUrl: 'https://sanbenito.com/es' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ offerUrl: 'https://sanbenito.com/es' });
  });
});
