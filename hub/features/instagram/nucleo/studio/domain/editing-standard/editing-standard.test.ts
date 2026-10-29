import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITING_GUIDELINES, EditingStandard } from './editing-standard';

const now = new Date('2026-10-21T12:00:00.000Z');

describe('EditingStandard', () => {
  it('começa com o padrão inicial', () => {
    const standard = EditingStandard.initial();
    expect(standard.version).toBe(0);
    expect(standard.guidelines).toEqual(DEFAULT_EDITING_GUIDELINES);
    expect(standard.style.font).toBe('Montserrat');
    expect(standard.updatedBy).toBeNull();
  });

  it('atualiza só o que veio, guardando quem e quando', () => {
    const standard = EditingStandard.initial();
    standard.update(
      { guidelines: { cta: '  Comente AMÉM.  ' }, style: { highlightColor: '#ff0000' } },
      'Ana',
      now,
    );
    expect(standard.guidelines.cta).toBe('Comente AMÉM.');
    expect(standard.guidelines.hook).toBe(DEFAULT_EDITING_GUIDELINES.hook);
    expect(standard.style.highlightColor).toBe('#FF0000');
    expect(standard.toSnapshot()).toMatchObject({
      updatedBy: 'Ana',
      updatedAt: '2026-10-21T12:00:00.000Z',
    });
  });

  it('recusa instrução vazia, cor inválida e fonte fora da lista', () => {
    const standard = EditingStandard.initial();
    expect(() => standard.update({ guidelines: { hook: '   ' } }, 'Ana', now)).toThrow(
      'Hook: escreva as instruções.',
    );
    expect(() => standard.update({ style: { textColor: 'branco' } }, 'Ana', now)).toThrow(
      'Cor do texto inválida.',
    );
    expect(() => standard.update({ style: { font: 'Comic Sans' as 'Inter' } }, 'Ana', now)).toThrow(
      'Fonte não disponível.',
    );
    expect(standard.updatedBy).toBeNull();
  });

  it('snapshot ida e volta', () => {
    const standard = EditingStandard.initial();
    standard.update({ style: { showHeadline: false } }, 'Ana', now);
    const copy = EditingStandard.fromSnapshot(standard.toSnapshot());
    expect(copy.toSnapshot()).toEqual(standard.toSnapshot());
  });
});
