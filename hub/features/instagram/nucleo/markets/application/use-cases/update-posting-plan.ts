import { ChannelId, NotFoundError } from '@sbs/shared-kernel';
import type { Channel, ChannelRepository, PostingSlot } from '../../domain';

export class UpdatePostingPlan {
  constructor(private readonly channels: ChannelRepository) {}

  async execute(channelId: string, slots: PostingSlot[]): Promise<Channel> {
    const channel = await this.channels.findById(ChannelId(channelId));
    if (!channel) throw new NotFoundError('Canal', channelId);

    channel.updatePostingPlan(slots);
    await this.channels.save(channel);
    return channel;
  }
}
