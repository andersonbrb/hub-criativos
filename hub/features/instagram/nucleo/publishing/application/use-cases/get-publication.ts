import { NotFoundError, PublicationId } from '@sbs/shared-kernel';
import type { Publication, PublicationRepository } from '../../domain';

export class GetPublication {
  constructor(private readonly publications: PublicationRepository) {}

  async execute(id: string): Promise<Publication> {
    const publication = await this.publications.findById(PublicationId(id));
    if (!publication) throw new NotFoundError('Publicação', id);
    return publication;
  }
}
