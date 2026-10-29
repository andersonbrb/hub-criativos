import { DomainError, MarketId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { aMarketProps } from '../../testing/builders';
import { Market } from './market';

const now = new Date('2026-10-15T12:00:00Z');
const create = (overrides = {}) => Market.create(MarketId('m-1'), aMarketProps(overrides), now);

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('Market', () => {
  it('nasce ativo e emite market_created', () => {
    const market = create();

    expect(market.status).toBe('active');
    expect(market.locale).toBe('es-419');
    expect(market.pullEvents().map((e) => e.type)).toEqual(['markets.market_created']);
  });

  it.each([
    ['código inválido', { code: 'ES LATAM' }, 'invalid_market_code'],
    ['fuso desconhecido', { timezone: 'Marte/Olympus' }, 'invalid_timezone'],
    ['link sem http', { offerUrl: 'ftp://oferta' }, 'invalid_offer_url'],
    ['link malformado', { offerUrl: 'não é url' }, 'invalid_offer_url'],
    ['produto vazio', { productName: '  ' }, 'invalid_product_name'],
    ['idioma inválido', { locale: '??' }, 'invalid_locale'],
  ])('rejeita %s', (_label, overrides, code) => {
    expect(errorCode(() => create(overrides))).toBe(code);
  });

  it('rejeita termos repetidos no glossário, sem diferenciar maiúsculas', () => {
    const glossary = [
      { source: 'São Bento', target: 'San Benito' },
      { source: 'são bento', target: 'San Benito' },
    ];
    expect(errorCode(() => create({ glossary }))).toBe('duplicate_glossary_term');
  });

  it('limpa e remove duplicatas dos termos proibidos', () => {
    const market = create({ forbiddenTerms: [' Sagrado Verso ', 'Sagrado Verso', ''] });
    expect(market.forbiddenTerms).toEqual(['Sagrado Verso']);
  });

  it('atualiza dados mantendo o código', () => {
    const market = create();
    market.update({ productName: 'San Benito Premium', timezone: 'America/Bogota' });

    expect(market.productName).toBe('San Benito Premium');
    expect(market.timezone).toBe('America/Bogota');
    expect(market.code).toBe('es-latam');
  });

  it('pausa e reativa', () => {
    const market = create();
    market.pause();
    expect(market.isActive).toBe(false);
    market.activate();
    expect(market.isActive).toBe(true);
  });

  it('sobrevive a ida e volta pelo snapshot', () => {
    const market = create();
    const copy = Market.fromSnapshot(market.toSnapshot());
    expect(copy.toSnapshot()).toEqual(market.toSnapshot());
  });
});
