import { ChannelId, MarketId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Channel } from '../../domain';
import { InMemoryChannelRepository } from '../../infrastructure';
import { ChangeChannelConnection } from './change-channel-connection';

describe('ChangeChannelConnection', () => {
  it('conecta à conta do Instagram e desconecta', async () => {
    const channels = new InMemoryChannelRepository();
    await channels.save(
      Channel.create(
        ChannelId('ch-1'),
        { marketId: MarketId('m-1'), handle: 'sanbenito.es', displayName: 'San Benito' },
        new Date('2026-10-19T12:00:00.000Z'),
      ),
    );
    const change = new ChangeChannelConnection(channels);

    const connected = await change.execute({ channelId: 'ch-1', externalAccountId: '17841400' });
    expect([connected.connectionStatus, connected.externalAccountId]).toEqual([
      'connected',
      '17841400',
    ]);

    const off = await change.execute({ channelId: 'ch-1', externalAccountId: null });
    expect(off.connectionStatus).toBe('disconnected');
  });

  it('falha para canal inexistente', async () => {
    const change = new ChangeChannelConnection(new InMemoryChannelRepository());
    await expect(change.execute({ channelId: 'x', externalAccountId: null })).rejects.toMatchObject(
      { code: 'not_found' },
    );
  });
});
