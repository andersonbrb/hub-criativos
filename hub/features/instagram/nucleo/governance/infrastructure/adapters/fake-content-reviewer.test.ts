import { describe, expect, it } from 'vitest';
import { ReviewCheck } from '../../domain';
import { aReviewableContent } from '../../testing';
import { FakeContentReviewer } from './fake-content-reviewer';

const input = (caption: string) => {
  const { format, hashtags, sourceCaption, market } = aReviewableContent();
  return { format, caption, hashtags, sourceCaption, market };
};

describe('FakeContentReviewer', () => {
  it('aprova as 4 checagens de IA numa legenda comum', async () => {
    const checks = await new FakeContentReviewer().review(input('Reza a San Benito con fe.'));

    expect(checks.map((c) => c.code)).toEqual([
      'translation_fidelity',
      'religious_accuracy',
      'forbidden_claims',
      'brand_tone',
    ]);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
    // A resposta tem de ser aceita pelo objeto de valor do domínio.
    expect(() => checks.map((c) => ReviewCheck.of(c))).not.toThrow();
  });

  it.each([
    ['es', 'Cura garantizada en 7 días'],
    ['es', 'Un MILAGRO GARANTIZADO para tu familia'],
    ['fr', 'Guérison garantie avec Saint Benoît'],
    ['pt', 'Resultado garantido'],
    ['qualquer', 'Proteção 100% contra o mal'],
  ])('reprova e bloqueia promessa de milagre (%s): %s', async (_lang, caption) => {
    const checks = await new FakeContentReviewer().review(input(caption));
    const claims = checks.find((c) => c.code === 'forbidden_claims');

    expect(claims).toMatchObject({ status: 'fail', blocking: true });
  });

  it('lança quando configurado para falhar', async () => {
    const reviewer = new FakeContentReviewer({ failWith: new Error('fora do ar') });
    await expect(reviewer.review(input('Oi'))).rejects.toThrow('fora do ar');
  });
});
