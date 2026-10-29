import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeContentReviewer, parseReviewChecks } from './claude-content-reviewer';

function fakeClient(text: string) {
  const create = vi.fn(async () => ({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
  }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const input = {
  format: 'reel' as const,
  caption: 'Oración de San Benito, ¡curación garantizada!',
  hashtags: ['#sanbenito'],
  sourceCaption: 'Oração de São Bento',
  market: {
    locale: 'es-419',
    productName: 'San Benito',
    offerUrl: 'https://sanbenito.example.com/es',
    forbiddenTerms: ['Sagrado Verso'],
    glossary: [{ source: 'São Bento', target: 'San Benito' }],
  },
};

describe('ClaudeContentReviewer', () => {
  it('devolve as quatro checagens; só promessa proibida reprovada bloqueia', async () => {
    const { client, create } = fakeClient(
      JSON.stringify({
        checks: [
          { code: 'translation_fidelity', status: 'pass', message: 'Fiel.' },
          { code: 'religious_accuracy', status: 'warn', message: 'Confira a data.' },
          { code: 'forbidden_claims', status: 'fail', message: 'Promete "curación garantizada".' },
          { code: 'brand_tone', status: 'fail', message: 'Tom agressivo.' },
        ],
      }),
    );

    const checks = await new ClaudeContentReviewer(client).review(input);

    expect(checks.map((c) => [c.code, c.status, c.blocking])).toEqual([
      ['translation_fidelity', 'pass', false],
      ['religious_accuracy', 'warn', false],
      ['forbidden_claims', 'fail', true],
      ['brand_tone', 'fail', false],
    ]);
    expect(checks[2]!.label).toBe('Promessas proibidas');
    expect(JSON.stringify(create.mock.calls[0])).toContain('curación garantizada');
  });
});

describe('parseReviewChecks', () => {
  it('ignora códigos desconhecidos e falha sem nenhuma checagem válida', () => {
    expect(() =>
      parseReviewChecks('{"checks":[{"code":"outro","status":"pass","message":"x"}]}'),
    ).toThrow('sem checagens');
    expect(() => parseReviewChecks('xx')).toThrow('JSON');
  });
});
