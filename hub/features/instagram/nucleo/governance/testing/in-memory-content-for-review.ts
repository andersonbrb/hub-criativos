import { NotFoundError } from '@sbs/shared-kernel';
import type { ContentForReview, ReviewableContent } from '../application';

/** Substitui o adaptador studio + markets do composition root nos testes. */
export class InMemoryContentForReview implements ContentForReview {
  private readonly contents = new Map<string, ReviewableContent>();

  put(content: ReviewableContent): void {
    this.contents.set(content.contentPieceId, structuredClone(content));
  }

  async get(contentPieceId: string): Promise<ReviewableContent> {
    const content = this.contents.get(contentPieceId);
    if (!content) throw new NotFoundError('Peça', contentPieceId);
    return structuredClone(content);
  }
}
