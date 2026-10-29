import { ChannelId, MarketId } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Channel, Market } from '../../domain';
import { InMemoryChannelRepository, InMemoryMarketRepository } from '../../infrastructure';
import { aMarketProps } from '../../testing';
import { ChangeChannelMarket } from './change-channel-market';
import { LinkInstagramAccount } from './link-instagram-account';

describe('LinkInstagramAccount', () => {
  const clock = new FixedClock('2026-10-19T12:00:00.000Z');
  let markets: InMemoryMarketRepository;
  let channels: InMemoryChannelRepository;
  let link: LinkInstagramAccount;

  const channel = (id: string, marketId: string, handle: string) =>
    Channel.create(
      ChannelId(id),
      { marketId: MarketId(marketId), handle, displayName: handle },
      clock.now(),
    );

  beforeEach(async () => {
    markets = new InMemoryMarketRepository();
    channels = new InMemoryChannelRepository();
    link = new LinkInstagramAccount(
      markets,
      channels,
      new SequentialIdGenerator('ch'),
      clock,
      new RecordingEventBus(),
    );
    for (const [id, code] of [
      ['m-es', 'es-latam'],
      ['m-fr', 'fr'],
    ] as const) {
      await markets.save(
        Market.create(MarketId(id), aMarketProps({ code, name: code }), clock.now()),
      );
    }
  });

  it('o canal provisório do mercado ganha o @ real informado pelo Instagram', async () => {
    await channels.save(channel('ch-fr', 'm-fr', 'momentdepriere.sb'));

    const linked = await link.execute({
      marketId: 'm-fr',
      username: 'MomentDePriere.FR',
      externalAccountId: '1784',
    });

    expect(linked.id).toBe('ch-fr');
    expect([linked.handle, linked.connectionStatus, linked.externalAccountId]).toEqual([
      'momentdepriere.fr',
      'connected',
      '1784',
    ]);
    expect(await channels.list()).toHaveLength(1);
  });

  it('sem canal no mercado, cria um com a grade padrão', async () => {
    const created = await link.execute({
      marketId: 'm-es',
      username: 'momentodeoracionsb',
      externalAccountId: '9001',
    });
    expect(created).toMatchObject({ handle: 'momentodeoracionsb', marketId: 'm-es' });
    expect(created.postingPlan.slots.length).toBeGreaterThan(0);
  });

  it('reconectar a mesma conta (mesmo id) não duplica; segue o @ atual e o mercado escolhido', async () => {
    await link.execute({ marketId: 'm-es', username: 'antigo', externalAccountId: '9001' });

    const again = await link.execute({
      marketId: 'm-fr',
      username: 'novo.nome',
      externalAccountId: '9001',
    });

    expect(await channels.list()).toHaveLength(1);
    expect([again.handle, again.marketId]).toEqual(['novo.nome', 'm-fr']);
  });

  it('reaproveita o canal com o mesmo @ mesmo em outro mercado', async () => {
    await channels.save(channel('ch-1', 'm-es', 'momentodeoracionsb'));
    const linked = await link.execute({
      marketId: 'm-es',
      username: 'momentodeoracionsb',
      externalAccountId: '42',
    });
    expect(linked.id).toBe('ch-1');
  });

  it('mercado inexistente é recusado', async () => {
    await expect(
      link.execute({ marketId: 'x', username: 'conta', externalAccountId: '1' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('o usuário troca o mercado da conta', async () => {
    await channels.save(channel('ch-1', 'm-es', 'conta'));
    const change = new ChangeChannelMarket(markets, channels);

    const moved = await change.execute({ channelId: 'ch-1', marketId: 'm-fr' });

    expect(moved.marketId).toBe('m-fr');
    expect((await channels.listByMarket(MarketId('m-fr'))).map((c) => c.id)).toEqual(['ch-1']);
    await expect(change.execute({ channelId: 'ch-1', marketId: 'nao' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
