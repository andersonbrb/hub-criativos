import { ReferencePostId } from '@sbs/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryReferencePostRepository } from '../../infrastructure';
import { aReferencePost } from '../../testing';
import { IgnoreReferencePost } from './ignore-reference-post';

describe('IgnoreReferencePost', () => {
  let posts: InMemoryReferencePostRepository;
  let ignore: IgnoreReferencePost;

  beforeEach(() => {
    posts = new InMemoryReferencePostRepository();
    ignore = new IgnoreReferencePost(posts);
  });

  it('ignora e salva', async () => {
    await posts.save(aReferencePost({ id: 'p1' }));

    await ignore.execute('p1');

    expect((await posts.findById(ReferencePostId('p1')))?.status).toBe('ignored');
  });

  it('não ignora post selecionado', async () => {
    const post = aReferencePost({ id: 'p1' });
    post.select(new Date('2026-10-15T12:00:00.000Z'));
    await posts.save(post);

    await expect(ignore.execute('p1')).rejects.toMatchObject({ code: 'post_already_selected' });
    expect((await posts.findById(ReferencePostId('p1')))?.status).toBe('selected');
  });

  it('falha para post inexistente', async () => {
    await expect(ignore.execute('x')).rejects.toMatchObject({ code: 'not_found' });
  });
});
