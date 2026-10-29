import {
  ChannelId,
  ContentPieceId,
  MarketId,
  PublicationId,
  NotFoundError,
} from '@sbs/shared-kernel';
import type {
  ChannelDirectory,
  PostingTarget,
  PublishableContent,
  PublishableContentData,
} from '../application';
import { Publication, type SchedulePublicationProps } from '../domain';

export function aPostingTarget(overrides: Partial<PostingTarget> = {}): PostingTarget {
  return {
    channelId: 'ch-1',
    marketId: 'm-1',
    timezone: 'America/Mexico_City',
    postingPlan: [
      { localTime: '10:00', format: 'reel' },
      { localTime: '14:00', format: 'carousel' },
      { localTime: '20:00', format: 'reel' },
    ],
    externalAccountId: '17841400000000000',
    ...overrides,
  };
}

export function aPublishableContent(
  overrides: Partial<PublishableContentData> = {},
): PublishableContentData {
  return {
    format: 'reel',
    caption: 'Oración a San Benito 🙏 #sanbenito #oracion',
    assets: {
      format: 'reel',
      videoUrl: 'https://cdn.example.com/v/1.mp4',
      coverUrl: 'https://cdn.example.com/v/1.jpg',
    },
    ...overrides,
  };
}

export function aScheduleProps(
  overrides: Partial<SchedulePublicationProps> = {},
): SchedulePublicationProps {
  return {
    contentPieceId: ContentPieceId('cp-1'),
    channelId: ChannelId('ch-1'),
    marketId: MarketId('m-1'),
    format: 'reel',
    scheduledAt: new Date('2026-10-15T16:00:00.000Z'),
    ...overrides,
  };
}

/** Publicação agendada, sem eventos pendentes. */
export function aPublication(
  overrides: Partial<SchedulePublicationProps> & { id?: string; now?: Date } = {},
): Publication {
  const { id = 'pub-1', now = new Date('2026-10-15T12:00:00.000Z'), ...props } = overrides;
  const publication = Publication.schedule(PublicationId(id), aScheduleProps(props), now);
  publication.pullEvents();
  return publication;
}

/** Diretório de canais em memória (o real é montado sobre `@sbs/markets`). */
export class StubChannelDirectory implements ChannelDirectory {
  private readonly targets = new Map<string, PostingTarget>();

  constructor(targets: PostingTarget[] = [aPostingTarget()]) {
    for (const t of targets) this.targets.set(t.channelId, t);
  }

  async getPostingTarget(channelId: string): Promise<PostingTarget> {
    const target = this.targets.get(channelId);
    if (!target) throw new NotFoundError('Canal', channelId);
    return structuredClone(target);
  }
}

/** Conteúdo publicável em memória (o real é montado sobre `@sbs/studio`). */
export class StubPublishableContent implements PublishableContent {
  private readonly contents = new Map<string, PublishableContentData>();

  set(contentPieceId: string, content: PublishableContentData = aPublishableContent()): this {
    this.contents.set(contentPieceId, content);
    return this;
  }

  async get(contentPieceId: string): Promise<PublishableContentData> {
    const content = this.contents.get(contentPieceId);
    if (!content) throw new NotFoundError('Peça', contentPieceId);
    return structuredClone(content);
  }
}
