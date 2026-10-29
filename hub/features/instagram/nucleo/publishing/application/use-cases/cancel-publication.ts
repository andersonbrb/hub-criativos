import { PublicationId, NotFoundError, type EventBus } from '@sbs/shared-kernel';
import type { Publication, PublicationRepository } from '../../domain';

export class CancelPublication {
  constructor(
    private readonly publications: PublicationRepository,
    private readonly events: EventBus,
  ) {}

  async execute(id: string): Promise<Publication> {
    const publication = await this.publications.findById(PublicationId(id));
    if (!publication) throw new NotFoundError('Publicação', id);

    publication.cancel();
    await this.publications.save(publication);
    await this.events.publish(publication.pullEvents());
    return publication;
  }
}
