import { describe, expect, it } from 'vitest';
import { aMarketProfile } from '../../testing';
import { FakeCopyLocalizer } from './fake-copy-localizer';

const sourceCaption = 'Oração de São Bento para proteger sua casa 🙏 #fe #oracao\nComente AMÉM';

describe('FakeCopyLocalizer', () => {
  it('aplica o glossário, tira as hashtags de origem e acrescenta o CTA da oferta', async () => {
    const copy = await new FakeCopyLocalizer().localize({
      sourceCaption,
      format: 'reel',
      sourceLocale: 'pt-BR',
      market: aMarketProfile(),
      suggestion: null,
    });

    expect(copy.caption).toBe(
      'Oración de San Benito para proteger sua casa 🙏\nComente AMÉM\n\n👉 San Benito: https://sanbenito.example.com/oferta',
    );
    expect(copy.hashtags).toEqual(['#sanbenito', '#oracion', '#fe', '#bendiciones', '#reels']);
  });

  it('usa hashtags do idioma do mercado e do nome do produto', async () => {
    const copy = await new FakeCopyLocalizer().localize({
      sourceCaption,
      format: 'carousel',
      sourceLocale: 'pt-BR',
      market: aMarketProfile({
        locale: 'fr-FR',
        productName: 'Saint Benoît',
        offerUrl: 'https://saintbenoit.example.com/offre',
        glossary: [{ source: 'são bento', target: 'Saint Benoît' }],
      }),
      suggestion: null,
    });

    expect(copy.caption).toContain('Oração de Saint Benoît');
    expect(copy.caption).toContain('👉 Saint Benoît: https://saintbenoit.example.com/offre');
    expect(copy.hashtags).toEqual(['#saintbenoit', '#priere', '#foi', '#benediction']);
    expect(copy.hashtags.length).toBeGreaterThanOrEqual(3);
  });

  it('marca na última linha a sugestão aplicada', async () => {
    const copy = await new FakeCopyLocalizer().localize({
      sourceCaption,
      format: 'reel',
      sourceLocale: 'pt-BR',
      market: aMarketProfile(),
      suggestion: 'Encurte a primeira frase.',
    });

    expect(copy.caption.split('\n').at(-1)).toBe('✍️ Ajuste aplicado: Encurte a primeira frase.');
  });
});
