import type { MarketProps } from '../domain';

export function aMarketProps(overrides: Partial<MarketProps> = {}): MarketProps {
  return {
    code: 'es-latam',
    name: 'Espanhol (América Latina)',
    locale: 'es-419',
    timezone: 'America/Mexico_City',
    productName: 'San Benito',
    offerUrl: 'https://sanbenito.example.com/oferta',
    glossary: [{ source: 'São Bento', target: 'San Benito' }],
    forbiddenTerms: ['Sagrado Verso'],
    ...overrides,
  };
}
