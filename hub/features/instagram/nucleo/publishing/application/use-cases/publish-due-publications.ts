import { ConcurrencyError, type Clock, type EventBus } from '@sbs/shared-kernel';
import type { Publication, PublicationRepository } from '../../domain';
import type { ChannelDirectory } from '../ports/channel-directory';
import type { PublishableContent } from '../ports/publishable-content';
import type { SocialPublisher } from '../ports/social-publisher';

export const RETRY_DELAY_MINUTES = 10;

export interface PublishDueResult {
  published: number;
  /** Esgotaram as tentativas nesta rodada. */
  failed: number;
  /** Falharam e voltaram para a fila em +10 min. */
  retried: number;
}

type Outcome = 'published' | 'failed' | 'retried' | 'skipped';

/**
 * Executado a cada minuto: publica tudo que já passou do horário agendado.
 *
 * Cada publicação é independente: falha de rede vira tentativa falha (com retry), e um
 * erro inesperado (ex.: banco fora) não impede as demais — é relançado no fim, junto.
 */
export class PublishDuePublications {
  constructor(
    private readonly publications: PublicationRepository,
    private readonly channels: ChannelDirectory,
    private readonly content: PublishableContent,
    private readonly publisher: SocialPublisher,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async execute(): Promise<PublishDueResult> {
    const result: PublishDueResult = { published: 0, failed: 0, retried: 0 };
    const unexpected: unknown[] = [];

    for (const publication of await this.publications.findDue(this.clock.now())) {
      try {
        const outcome = await this.publishOne(publication);
        if (outcome !== 'skipped') result[outcome] += 1;
      } catch (error) {
        unexpected.push(error);
      }
    }

    if (unexpected.length > 0) {
      throw new AggregateError(
        unexpected,
        `${unexpected.length} publicação(ões) com erro inesperado.`,
      );
    }
    return result;
  }

  private async publishOne(publication: Publication): Promise<Outcome> {
    try {
      publication.startPublishing(this.clock.now());
      // Gravar `publishing` antes de chamar a rede: uma execução concorrente perde
      // na concorrência otimista em vez de publicar o mesmo post duas vezes.
      await this.save(publication);
    } catch (error) {
      if (error instanceof ConcurrencyError) return 'skipped';
      throw error;
    }

    try {
      const content = await this.content.get(publication.contentPieceId);
      const target = await this.channels.getPostingTarget(publication.channelId);
      const media = await this.publisher.publish({
        channelId: publication.channelId,
        channelExternalAccountId: target.externalAccountId,
        format: publication.format,
        assets: content.assets,
        caption: content.caption,
      });
      publication.markPublished(media, this.clock.now());
    } catch (error) {
      const now = this.clock.now();
      const retryAt = new Date(now.getTime() + RETRY_DELAY_MINUTES * 60_000);
      publication.markAttemptFailed(describe(error), now, retryAt);
      await this.save(publication);
      return publication.status === 'failed' ? 'failed' : 'retried';
    }

    await this.save(publication);
    return 'published';
  }

  private async save(publication: Publication): Promise<void> {
    await this.publications.save(publication);
    await this.events.publish(publication.pullEvents());
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
