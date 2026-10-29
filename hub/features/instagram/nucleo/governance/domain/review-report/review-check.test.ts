import { DomainError } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { aReviewCheck } from '../../testing/builders';
import { ReviewCheck } from './review-check';

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('ReviewCheck', () => {
  it('limpa espaços do código, do nome e da mensagem', () => {
    const check = ReviewCheck.of(
      aReviewCheck({ code: ' brand_tone ', label: ' Tom da marca ', message: ' Ok. ' }),
    );
    expect(check.toProps()).toEqual({
      code: 'brand_tone',
      label: 'Tom da marca',
      status: 'pass',
      blocking: false,
      message: 'Ok.',
    });
  });

  it('só é problema bloqueante quando reprova e bloqueia', () => {
    expect(ReviewCheck.fail('x_check', 'X', 'm').isBlockingIssue).toBe(true);
    expect(ReviewCheck.fail('x_check', 'X', 'm', false).isBlockingIssue).toBe(false);
    expect(ReviewCheck.warn('x_check', 'X', 'm').isBlockingIssue).toBe(false);
  });

  it.each([
    ['código com espaço', { code: 'brand tone' }],
    ['código vazio', { code: '' }],
    ['nome vazio', { label: '  ' }],
    ['mensagem vazia', { message: '' }],
    ['situação desconhecida', { status: 'ok' as never }],
    ['aviso bloqueante', { status: 'warn' as const, blocking: true }],
    ['aprovação bloqueante', { status: 'pass' as const, blocking: true }],
  ])('rejeita %s', (_label, overrides) => {
    expect(errorCode(() => ReviewCheck.of(aReviewCheck(overrides)))).toBe('invalid_review_check');
  });
});
