import { NotFoundError, ReferencePostId } from '@sbs/shared-kernel';
import type { ReferencePost, ReferencePostRepository } from '../../domain';

export class IgnoreReferencePost {
  constructor(private readonly posts: ReferencePostRepository) {}

  async execute(referencePostId: string): Promise<ReferencePost> {
    const post = await this.posts.findById(ReferencePostId(referencePostId));
    if (!post) throw new NotFoundError('Post de referência', referencePostId);

    post.ignore();
    await this.posts.save(post);
    return post;
  }
}
