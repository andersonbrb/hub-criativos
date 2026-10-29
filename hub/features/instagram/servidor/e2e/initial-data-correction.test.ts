import { Channel } from '@sbs/markets';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../composition/container';
import { correctInitialData, seedDemoData } from '../composition/seed-demo';
import { openTestDatabase, testPlatform } from './test-env';

describe('correção da configuração inicial (banco)', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;

  beforeAll(async () => {
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock: new FixedClock('2026-10-19T12:00:00.000Z'),
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform(),
    });
    await seedDemoData(container, { runPipeline: false });
  }, 60_000);

  afterAll(async () => {
    container.jobs.close();
    await handle.close();
  });

  it('a configuração inicial já cria o canal francês com @momentdepriere.fr', async () => {
    const handles = (await container.markets.channels.list()).map((c) => c.handle).sort();
    expect(handles).toEqual(['momentdepriere.fr', 'momentodeoracionsb']);
  });

  it('banco antigo com @momentdepriere.sb é corrigido uma vez só', async () => {
    const fr = (await container.markets.channels.findByHandle('momentdepriere.fr'))!;
    await container.markets.channels.save(
      Channel.fromSnapshot({ ...fr.toSnapshot(), handle: 'momentdepriere.sb' }),
    );

    expect(await correctInitialData(container)).toBe(1);
    expect((await container.markets.channels.findById(fr.id))?.handle).toBe('momentdepriere.fr');
    expect(await correctInitialData(container)).toBe(0);
  });
});
