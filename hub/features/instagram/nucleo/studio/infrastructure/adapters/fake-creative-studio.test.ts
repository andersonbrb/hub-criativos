import { describe, expect, it } from 'vitest';
import type { ProduceCreativeInput } from '../../application';
import { FakeCreativeStudio } from './fake-creative-studio';

const input = (overrides: Partial<ProduceCreativeInput> = {}): ProduceCreativeInput => ({
  contentPieceId: 'piece-1',
  format: 'reel',
  sourceMediaUrls: ['https://cdn.example.com/ref/abc.mp4'],
  targetLocale: 'es-419',
  productName: 'San Benito',
  suggestion: null,
  keepOriginalMusic: true,
  ...overrides,
});

describe('FakeCreativeStudio', () => {
  it('devolve o reel no idioma do mercado e muda o link a cada nova produção', async () => {
    const studio = new FakeCreativeStudio();

    const first = await studio.produce(input());
    const second = await studio.produce(input());

    expect(first).toMatchObject({
      status: 'completed',
      assets: {
        format: 'reel',
        videoUrl: 'https://cdn.example.com/ref/abc.mp4?locale=es-419&rev=1',
      },
    });
    expect(second).toMatchObject({
      assets: { videoUrl: 'https://cdn.example.com/ref/abc.mp4?locale=es-419&rev=2' },
    });
  });

  it('re-renderiza um slide por mídia de origem, com sementes por idioma', async () => {
    const studio = new FakeCreativeStudio();
    const carousel = input({
      format: 'carousel',
      sourceMediaUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
    });

    const es = await studio.produce(carousel);
    const fr = await studio.produce({
      ...carousel,
      contentPieceId: 'piece-2',
      targetLocale: 'fr-FR',
    });

    if (es.status !== 'completed' || es.assets.format !== 'carousel')
      throw new Error('esperava carrossel');
    if (fr.status !== 'completed' || fr.assets.format !== 'carousel')
      throw new Error('esperava carrossel');
    expect(es.assets.slideUrls).toHaveLength(2);
    for (const url of es.assets.slideUrls) {
      expect(url).toMatch(/^https:\/\/picsum\.photos\/seed\/[a-z0-9]+-es-419\/1080\/1350$/);
    }
    expect(fr.assets.slideUrls[0]).toMatch(/-fr-fr\/1080\/1350$/);
    expect(new Set(es.assets.slideUrls).size).toBe(2);
  });

  it('pode responder pending ou falhar, para testes', async () => {
    await expect(new FakeCreativeStudio({ mode: 'pending' }).produce(input())).resolves.toEqual({
      status: 'pending',
      jobId: 'fake-creative-piece-1-1',
    });
    await expect(
      new FakeCreativeStudio({ mode: 'fail', failureMessage: 'boom' }).produce(input()),
    ).rejects.toThrow('boom');
  });
});
