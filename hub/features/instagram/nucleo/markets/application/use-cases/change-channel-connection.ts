import { ChannelId, NotFoundError } from '@sbs/shared-kernel';
import type { Channel, ChannelRepository } from '../../domain';

export interface ChangeChannelConnectionInput {
  channelId: string;
  /** Id da conta no Instagram ao conectar; `null` desconecta. */
  externalAccountId: string | null;
}

/** Marca o canal como conectado à conta do Instagram (login oficial) ou desconectado. */
export class ChangeChannelConnection {
  constructor(private readonly channels: ChannelRepository) {}

  async execute(input: ChangeChannelConnectionInput): Promise<Channel> {
    const channel = await this.channels.findById(ChannelId(input.channelId));
    if (!channel) throw new NotFoundError('Canal', input.channelId);

    if (input.externalAccountId === null) channel.disconnect();
    else channel.connect(input.externalAccountId);
    await this.channels.save(channel);
    return channel;
  }
}
