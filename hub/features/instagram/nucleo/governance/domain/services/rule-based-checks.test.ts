import { describe, expect, it } from 'vitest';
import { aRuleCheckInput, carouselAssets, reelAssets } from '../../testing/builders';
import type { ReviewCheck } from '../review-report/review-check';
import { RuleBasedChecks, publishedCaptionLength, type RuleCheckInput } from './rule-based-checks';

const rules = new RuleBasedChecks();

function check(code: string, overrides: Parameters<typeof aRuleCheckInput>[0] = {}): ReviewCheck {
  const found = rules.run(aRuleCheckInput(overrides)).find((c) => c.code === code);
  if (!found) throw new Error(`checagem ${code} ausente`);
  return found;
}

const statusOf = (code: string, overrides: Parameters<typeof aRuleCheckInput>[0] = {}) => {
  const c = check(code, overrides);
  return { status: c.status, blocking: c.blocking };
};

const PASS = { status: 'pass', blocking: false };
const WARN = { status: 'warn', blocking: false };
const BLOCKING_FAIL = { status: 'fail', blocking: true };

const tags = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`);

describe('RuleBasedChecks', () => {
  it('um reel em ordem passa em todas as regras, na ordem da tabela', () => {
    const checks = rules.run(aRuleCheckInput());

    expect(checks.map((c) => c.code)).toEqual([
      'caption_length',
      'hashtag_count',
      'forbidden_terms',
      'product_mention',
      'assets_present',
      'ai_label',
    ]);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
  });

  describe('caption_length', () => {
    it.each([
      ['2200 caracteres sem hashtags', 'a'.repeat(2200), [], PASS],
      ['2201 caracteres sem hashtags', 'a'.repeat(2201), [], BLOCKING_FAIL],
      // 2194 + "\n\n" + "#abc" = 2200
      ['2200 contando hashtags', 'a'.repeat(2194), ['abc'], PASS],
      ['2201 contando hashtags', 'a'.repeat(2195), ['abc'], BLOCKING_FAIL],
    ])('%s', (_label, caption, hashtags, expected) => {
      expect(statusOf('caption_length', { caption, hashtags })).toEqual(expected);
    });

    it('conta emoji como um caractere e não duplica o # já informado', () => {
      expect(publishedCaptionLength('🙏🙏', [])).toBe(2);
      expect(publishedCaptionLength('oi', ['#fe', 'luz'])).toBe('oi\n\n#fe #luz'.length);
    });

    it('explica quanto cortar', () => {
      expect(
        check('caption_length', { caption: 'a'.repeat(2205), hashtags: [] }).message,
      ).toContain('Corte 5');
    });
  });

  describe('hashtag_count', () => {
    it.each([
      [0, PASS],
      [10, PASS],
      [11, WARN],
      [30, WARN],
      [31, BLOCKING_FAIL],
    ])('%i hashtags', (count, expected) => {
      expect(statusOf('hashtag_count', { hashtags: tags(count) })).toEqual(expected);
    });
  });

  describe('forbidden_terms', () => {
    const market = { forbiddenTerms: ['Sagrado Verso', 'cura'] };

    it.each([
      ['minúsculas', 'Rece o sagrado verso hoje.'],
      ['maiúsculas', 'Rece o SAGRADO VERSO hoje.'],
      ['com acento a mais', 'Rece o Ságrado Vérso hoje.'],
      ['com quebra de linha no meio', 'Rece o Sagrado\nVerso hoje.'],
      ['com pontuação colada', 'Conheça o "Sagrado Verso"!'],
    ])('encontra o termo na legenda (%s)', (_label, caption) => {
      expect(statusOf('forbidden_terms', { caption, market })).toEqual(BLOCKING_FAIL);
    });

    it('encontra termo cadastrado com acento numa legenda sem acento', () => {
      expect(
        statusOf('forbidden_terms', {
          caption: 'La oracion milagrosa de hoy',
          market: { forbiddenTerms: ['Oración Milagrosa'] },
        }),
      ).toEqual(BLOCKING_FAIL);
    });

    it.each([['#SagradoVerso'], ['sagrado_verso'], ['SAGRADOVERSOOFICIAL'], ['#sagrádoverso']])(
      'encontra o termo na hashtag %s',
      (hashtag) => {
        expect(statusOf('forbidden_terms', { hashtags: ['fe', hashtag], market })).toEqual(
          BLOCKING_FAIL,
        );
      },
    );

    it('não confunde o termo com parte de outra palavra', () => {
      expect(
        statusOf('forbidden_terms', { caption: 'Quem procura, encontra paz.', market }),
      ).toEqual(PASS);
    });

    it('lista os termos encontrados, como foram cadastrados', () => {
      const found = check('forbidden_terms', {
        caption: 'Sagrado verso que cura',
        market,
      });
      expect(found.message).toContain('"Sagrado Verso", "cura"');
    });

    it('passa quando o mercado não tem termos proibidos', () => {
      const found = check('forbidden_terms', { market: { forbiddenTerms: [] } });
      expect(found.status).toBe('pass');
      expect(found.message).toContain('não tem termos proibidos');
    });
  });

  describe('product_mention', () => {
    it('aceita o nome do produto sem acento e em outra caixa', () => {
      expect(
        statusOf('product_mention', {
          caption: 'La médaille de SAINT BENOIT protège ta maison.',
          market: { productName: 'Saint Benoît' },
        }),
      ).toEqual(PASS);
    });

    it('avisa, sem bloquear, quando o produto não aparece', () => {
      expect(statusOf('product_mention', { caption: 'Reza con fe cada noche.' })).toEqual(WARN);
    });
  });

  describe('assets_present', () => {
    const carousel = (assets: RuleCheckInput['assets']) =>
      statusOf('assets_present', { format: 'carousel', assets });

    it('reprova peça sem mídia', () => {
      expect(statusOf('assets_present', { assets: null })).toEqual(BLOCKING_FAIL);
    });

    it('reprova mídia de formato diferente da peça', () => {
      expect(carousel(reelAssets())).toEqual(BLOCKING_FAIL);
      expect(statusOf('assets_present', { format: 'reel', assets: carouselAssets(3) })).toEqual(
        BLOCKING_FAIL,
      );
    });

    it('reprova reel sem vídeo', () => {
      expect(
        statusOf('assets_present', { assets: { format: 'reel', videoUrl: ' ', coverUrl: null } }),
      ).toEqual(BLOCKING_FAIL);
    });

    it.each([
      [1, BLOCKING_FAIL],
      [2, PASS],
      [20, PASS],
      [21, BLOCKING_FAIL],
    ])('carrossel com %i slide(s)', (slides, expected) => {
      expect(carousel(carouselAssets(slides))).toEqual(expected);
    });
  });

  describe('ai_label', () => {
    it('é informativo e aprovado para reels', () => {
      const found = check('ai_label');
      expect(found.status).toBe('pass');
      expect(found.message).toContain('Feito com IA');
    });

    it('não se aplica a carrosséis', () => {
      const codes = rules
        .run(aRuleCheckInput({ format: 'carousel', assets: carouselAssets() }))
        .map((c) => c.code);
      expect(codes).not.toContain('ai_label');
    });
  });
});
