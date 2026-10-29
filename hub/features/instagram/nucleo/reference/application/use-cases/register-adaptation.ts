import { NotFoundError, ReferencePostId } from '@sbs/shared-kernel';
import type { ReferencePost, ReferencePostRepository } from '../../domain';

/**
 * Conta uma adaptação criada a partir do post. O composition root liga este caso de uso
 * ao evento do estúdio que confirma a criação da peça.
 */
export class RegisterAdaptation {
  constructor(private readonly posts: ReferencePostRepository) {}

  async execute(referencePostId: string): Promise<ReferencePost> {
    const post = await this.posts.findById(ReferencePostId(referencePostId));
    if (!post) throw new NotFoundError('Post de referência', referencePostId);

    post.registerAdaptation();
    await this.posts.save(post);
    return post;
  }
}
