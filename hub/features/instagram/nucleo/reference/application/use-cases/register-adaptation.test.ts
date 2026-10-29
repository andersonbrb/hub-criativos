import { ReferencePostId } from '@sbs/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryReferencePostRepository } from '../../infrastructure';
import { aReferencePost } from '../../testing';
import { RegisterAdaptation } from './register-adaptation';

describe('RegisterAdaptation', () => {
  let posts: InMemoryReferencePostRepository;
  let register: RegisterAdaptation;

  beforeEach(async () => {
    posts = new InMemoryReferencePostRepository();
    register = new RegisterAdaptation(posts);
    const post = aReferencePost({ id: 'p1' });
    post.select(new Date('2026-10-15T12:00:00.000Z'));
    await posts.save(post);
  });

  it('incrementa e persiste o contador de adaptações a cada chamada', async () => {
    await register.execute('p1');
    await register.execute('p1');

    expect((await posts.findById(ReferencePostId('p1')))?.adaptationsCount).toBe(2);
  });

  it('falha para post inexistente', async () => {
    await expect(register.execute('x')).rejects.toMatchObject({ code: 'not_found' });
  });
});
