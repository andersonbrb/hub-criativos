import { DomainError } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryChannelRepository, InMemoryMarketRepository } from '../../infrastructure';
import { aMarketProps } from '../../testing';
import { MarketDirectoryQuery } from '../queries/market-directory-query';
import { CreateChannel } from './create-channel';
import { CreateMarket } from './create-market';
import { UpdateMarket } from './update-market';

describe('casos de uso de Mercados', () => {
  let markets: InMemoryMarketRepository;
  let channels: InMemoryChannelRepository;
  let events: RecordingEventBus;
  let createMarket: CreateMarket;
  let createChannel: CreateChannel;

  beforeEach(() => {
    markets = new InMemoryMarketRepository();
    channels = new InMemoryChannelRepository();
    events = new RecordingEventBus();
    const ids = new SequentialIdGenerator('id');
    const clock = new FixedClock();
    createMarket = new CreateMarket(markets, ids, clock, events);
    createChannel = new CreateChannel(markets, channels, ids, clock, events);
  });

  it('cria um mercado, salva e publica o evento', async () => {
    const market = await createMarket.execute(aMarketProps());

    expect(await markets.findById(market.id)).not.toBeNull();
    expect(events.typesPublished()).toEqual(['markets.market_created']);
  });

  it('não aceita dois mercados com o mesmo código', async () => {
    await createMarket.execute(aMarketProps());
    await expect(createMarket.execute(aMarketProps())).rejects.toMatchObject({
      code: 'market_code_taken',
    });
  });

  it('não cria canal para mercado inexistente', async () => {
    await expect(
      createChannel.execute({ marketId: 'x', handle: 'conta', displayName: 'Conta' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('não aceita a mesma conta duas vezes', async () => {
    const market = await createMarket.execute(aMarketProps());
    await createChannel.execute({ marketId: market.id, handle: 'conta', displayName: 'Conta' });
    await expect(
      createChannel.execute({ marketId: market.id, handle: '@Conta', displayName: 'Outra' }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('o diretório lista só canais de mercados ativos', async () => {
    const es = await createMarket.execute(aMarketProps());
    const fr = await createMarket.execute(
      aMarketProps({
        code: 'fr',
        locale: 'fr-FR',
        timezone: 'Europe/Paris',
        productName: 'Saint Benoît',
      }),
    );
    await createChannel.execute({ marketId: es.id, handle: 'es_conta', displayName: 'ES' });
    await createChannel.execute({ marketId: fr.id, handle: 'fr_conta', displayName: 'FR' });
    await new UpdateMarket(markets, events).execute(fr.id, { status: 'paused' });

    const targets = await new MarketDirectoryQuery(markets, channels).listActiveTargets();

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ marketId: es.id, locale: 'es-419' });
    expect(targets[0]!.postingPlan).toHaveLength(3);
  });
});
