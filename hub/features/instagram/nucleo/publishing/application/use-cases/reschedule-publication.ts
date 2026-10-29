import { PublicationId, NotFoundError, type Clock, type EventBus } from '@sbs/shared-kernel';
import type { Publication, PublicationRepository } from '../../domain';

export interface ReschedulePublicationInput {
  scheduledAt: Date;
}

export class ReschedulePublication {
  constructor(
    private readonly publications: PublicationRepository,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async execute(id: string, input: ReschedulePublicationInput): Promise<Publication> {
    const publication = await this.publications.findById(PublicationId(id));
    if (!publication) throw new NotFoundError('Publicação', id);

    publication.reschedule(input.scheduledAt, this.clock.now());
    await this.publications.save(publication);
    await this.events.publish(publication.pullEvents());
    return publication;
  }
}
