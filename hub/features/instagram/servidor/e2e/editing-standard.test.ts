import type { EditingStandard } from '@sbs/contracts';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../composition/container';
import { buildServer, type Server } from '../http/server';
import { asUser, openTestDatabase, testPlatform } from './test-env';

describe('Padrão de Edição (API + banco)', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;
  let server: Server;

  beforeAll(async () => {
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock: new FixedClock('2026-10-21T12:00:00.000Z'),
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform(),
    });
    server = await buildServer(container);
  }, 120_000);

  afterAll(async () => {
    container.jobs.close();
    await server.close();
    await handle.close();
  });

  it('devolve o padrão inicial antes de qualquer edição', async () => {
    const res = await server.inject({ method: 'GET', url: '/editing-standard' });
    expect(res.statusCode).toBe(200);
    const body = res.json<EditingStandard>();
    expect(body.updatedBy).toBeNull();
    expect(body.style.font).toBe('Montserrat');
    expect(body.guidelines.hook.length).toBeGreaterThan(20);
  });

  it('o social media edita e a edição fica salva', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/editing-standard',
      headers: asUser('reviewer'),
      payload: { guidelines: { cta: 'Comente AMÉM.' }, style: { highlightColor: '#ffcc00' } },
    });
    expect(res.statusCode).toBe(200);

    const saved = (
      await server.inject({ method: 'GET', url: '/editing-standard' })
    ).json<EditingStandard>();
    expect(saved.guidelines.cta).toBe('Comente AMÉM.');
    expect(saved.style.highlightColor).toBe('#FFCC00');
    expect(saved.updatedBy).toBe('Social Media');
  });

  it('recusa instrução vazia', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/editing-standard',
      payload: { guidelines: { hook: '' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
