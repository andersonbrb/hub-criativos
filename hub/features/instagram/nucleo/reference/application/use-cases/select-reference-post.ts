import {
  NotFoundError,
  ReferencePostId,
  type Clock,
  type EventBus,
  type ProductionOptions,
} from '@sbs/shared-kernel';
import { ReferenceErrors, type ReferencePost, type ReferencePostRepository } from '../../domain';
import type { AdaptationTracker } from '../ports/adaptation-tracker';

/**
 * Seleção manual de um post pelo time de social media, fora da política automática.
 * Um post já selecionado (ou ignorado) pode ser selecionado de novo — uma nova rodada de
 * adaptações — desde que nenhuma adaptação dele esteja em andamento.
 */
export class SelectReferencePost {
  constructor(
    private readonly posts: ReferencePostRepository,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly adaptations: AdaptationTracker,
  ) {}

  async execute(referencePostId: string, production?: ProductionOptions): Promise<ReferencePost> {
    const post = await this.posts.findById(ReferencePostId(referencePostId));
    if (!post) throw new NotFoundError('Post de referência', referencePostId);
    const open = await this.adaptations.countOpen(post.id);
    if (open > 0) throw ReferenceErrors.adaptationsInProgress(open);

    post.select(this.clock.now(), production);
    await this.posts.save(post);
    await this.events.publish(post.pullEvents());
    return post;
  }
}
