import type { ReferenceSource, SyncResult } from '@sbs/contracts';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../composition/container';
import { seedDemoData } from '../composition/seed-demo';
import { buildServer, type Server } from '../http/server';
import { asUser, openTestDatabase, testPlatform } from './test-env';

/** Páginas de referência pela API: cadastro, conectar/desconectar e sincronização. */
describe('páginas de referência (API + banco)', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;
  let server: Server;

  const call = async <T>(
    method: 'GET' | 'POST' | 'PUT',
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
    return { status: res.statusCode, body: res.json() as T };
  };
  const sources = async () => (await call<ReferenceSource[]>('GET', '/reference/sources')).body;

  beforeAll(async () => {
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock: new FixedClock('2026-10-15T12:00:00.000Z'),
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform(),
    });
    server = await buildServer(container);
    await seedDemoData(container, { runPipeline: false });
  }, 60_000);

  afterAll(async () => {
    container.jobs.close();
    await server.close();
    await handle.close();
  });

  it('a página inicial já vem conectada', async () => {
    expect(await sources()).toEqual([
      expect.objectContaining({
        handle: 'santaespiritualidade',
        connectionStatus: 'connected',
        postsCount: 0,
      }),
    ]);
  });

  it('o admin cadastra pelo link do perfil; revisor não pode', async () => {
    const denied = await call('POST', '/reference/sources', { handle: 'outra' }, 'reviewer');
    expect(denied.status).toBe(403);

    const created = await call<ReferenceSource>('POST', '/reference/sources', {
      handle: 'https://www.instagram.com/Outra.Pagina/?hl=pt',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ handle: 'outra.pagina', connectionStatus: 'connected' });

    const duplicate = await call<{ code: string }>('POST', '/reference/sources', {
      handle: '@outra.pagina',
    });
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.code).toBe('source_handle_taken');
  });

  it('sincroniza só as páginas conectadas', async () => {
    const outra = (await sources()).find((s) => s.handle === 'outra.pagina')!;
    const off = await call<ReferenceSource>('PUT', `/reference/sources/${outra.id}/connection`, {
      connected: false,
    });
    expect(off.body.connectionStatus).toBe('disconnected');

    const sync = await call<SyncResult>('POST', '/reference/sync');
    expect(sync.body).toMatchObject({ sources: 1, imported: 12 });

    const after = await sources();
    expect(after.find((s) => s.handle === 'santaespiritualidade')?.postsCount).toBe(12);
    expect(after.find((s) => s.handle === 'outra.pagina')).toMatchObject({
      postsCount: 0,
      lastSyncedAt: null,
    });

    const one = await call<{ code: string }>('POST', `/reference/sources/${outra.id}/sync`);
    expect(one.status).toBe(422);
    expect(one.body.code).toBe('reference_source_disconnected');
  });

  it('reconectar volta a puxar os posts da página', async () => {
    const outra = (await sources()).find((s) => s.handle === 'outra.pagina')!;
    const denied = await call(
      'PUT',
      `/reference/sources/${outra.id}/connection`,
      { connected: true },
      'reviewer',
    );
    expect(denied.status).toBe(403);

    await call('PUT', `/reference/sources/${outra.id}/connection`, { connected: true });
    const one = await call<SyncResult>('POST', `/reference/sources/${outra.id}/sync`);
    expect(one.body).toMatchObject({ sources: 1, imported: 12 });
  });
});
