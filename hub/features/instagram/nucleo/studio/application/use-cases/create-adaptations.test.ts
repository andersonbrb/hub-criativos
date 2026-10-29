import { beforeEach, describe, expect, it } from 'vitest';
import { ContentPiece } from '../../domain';
import {
  aMarketProfile,
  aReferencePostSelectedPayload,
  createStudioTestKit,
  type StudioTestKit,
} from '../../testing';

describe('CreateAdaptations', () => {
  let kit: StudioTestKit;

  beforeEach(() => {
    kit = createStudioTestKit();
  });

  it('cria uma peça por mercado ativo, copiando o post de referência', async () => {
    const created = await kit.createAdaptations.execute(aReferencePostSelectedPayload());

    expect(created.map((p) => [p.marketId, p.channelId])).toEqual([
      ['market-es', 'channel-es'],
      ['market-fr', 'channel-fr'],
    ]);
    const stored = await kit.pieces.findById(created[0]!.id);
    expect(stored).toMatchObject({ status: 'queued', format: 'reel', referencePostId: 'post-1' });
    expect(stored!.source).toEqual({
      caption: 'Oração de São Bento para proteger sua casa 🙏 #fe #oracao',
      permalink: 'https://www.instagram.com/p/ABC123/',
      thumbnailUrl: 'https://cdn.example.com/ref/abc123-thumb.jpg',
      mediaUrls: ['https://cdn.example.com/ref/abc123.mp4'],
    });
  });

  it('enfileira studio.produce para cada peça nova e publica content_piece_created', async () => {
    await kit.createAdaptations.execute(aReferencePostSelectedPayload());

    expect(kit.jobs.jobs).toEqual([
      { job: 'studio.produce', payload: { contentPieceId: 'piece-1' } },
      { job: 'studio.produce', payload: { contentPieceId: 'piece-2' } },
    ]);
    expect(kit.events.typesPublished()).toEqual([
      'studio.content_piece_created',
      'studio.content_piece_created',
    ]);
  });

  it('ignora mercados pausados', async () => {
    kit.markets.add(aMarketProfile({ marketId: 'market-it', status: 'paused' }), 'channel-it');

    const created = await kit.createAdaptations.execute(aReferencePostSelectedPayload());

    expect(created.map((p) => p.marketId)).not.toContain('market-it');
  });

  it('é idempotente por (post, mercado): reentregar o evento não duplica peças', async () => {
    await kit.createAdaptations.execute(aReferencePostSelectedPayload());
    kit.markets.add(aMarketProfile({ marketId: 'market-it', locale: 'it-IT' }), 'channel-it');

    const second = await kit.createAdaptations.execute(aReferencePostSelectedPayload());

    expect(second.map((p) => p.marketId)).toEqual(['market-it']);
    expect(await kit.pieces.list()).toHaveLength(3);
    expect(kit.jobs.jobs).toHaveLength(3);
  });

  it.each(['rejected', 'published'] as const)(
    'peça %s encerra a rodada: selecionar de novo cria outra peça só nesse mercado',
    async (closed) => {
      const [es] = await kit.createAdaptations.execute(aReferencePostSelectedPayload());
      const stored = await kit.pieces.findById(es!.id);
      await kit.pieces.save(ContentPiece.fromSnapshot({ ...stored!.toSnapshot(), status: closed }));

      const second = await kit.createAdaptations.execute(aReferencePostSelectedPayload());

      // FR ainda está em andamento: não duplica. ES estava encerrada: nova peça.
      expect(second.map((p) => p.marketId)).toEqual(['market-es']);
      expect(second[0]!.id).not.toBe(es!.id);
      expect(await kit.pieces.listByReference(es!.referencePostId)).toHaveLength(3);
    },
  );

  it('outro post gera novas peças para os mesmos mercados', async () => {
    await kit.createAdaptations.execute(aReferencePostSelectedPayload());
    const created = await kit.createAdaptations.execute(
      aReferencePostSelectedPayload({ referencePostId: 'post-2', format: 'carousel' }),
    );

    expect(created).toHaveLength(2);
    expect(created.every((p) => p.format === 'carousel')).toBe(true);
  });
});
