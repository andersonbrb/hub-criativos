import { describe, expect, it } from 'vitest';
import {
  REVIEWER,
  aReferencePostSelectedPayload,
  createStudioTestKit,
  type StudioTestKit,
} from '../../testing';

async function aQueuedPiece(kit: StudioTestKit, format: 'reel' | 'carousel' = 'reel') {
  const [piece] = await kit.createAdaptations.execute(
    aReferencePostSelectedPayload(
      format === 'carousel'
        ? {
            format,
            mediaUrls: ['https://cdn.example.com/ref/1.jpg', 'https://cdn.example.com/ref/2.jpg'],
          }
        : {},
    ),
  );
  kit.events.published.length = 0;
  kit.jobs.jobs.length = 0;
  return piece!.id;
}

describe('ProduceContentPiece', () => {
  it('produz legenda e mídia e manda para a revisão automática', async () => {
    const kit = createStudioTestKit();
    const id = await aQueuedPiece(kit);

    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('ai_review');
    expect(piece.currentRevision.caption).toContain('Oración de San Benito para proteger sua casa');
    expect(piece.currentRevision.caption).toContain(
      '👉 San Benito: https://sanbenito.example.com/oferta',
    );
    expect(piece.currentRevision.hashtags).toEqual([
      '#sanbenito',
      '#oracion',
      '#fe',
      '#bendiciones',
      '#reels',
    ]);
    expect(piece.currentRevision.assets).toMatchObject({
      format: 'reel',
      videoUrl: 'https://cdn.example.com/ref/abc123.mp4?locale=es-419&rev=1',
    });
    expect(piece.history.map((h) => h.to)).toEqual(['queued', 'producing', 'ai_review']);
    expect(kit.events.typesPublished()).toEqual(['studio.content_piece_produced']);
    expect(kit.events.published[0]!.payload).toEqual({
      contentPieceId: id,
      marketId: 'market-es',
      revisionNumber: 1,
    });
    expect((await kit.pieces.findById(id))!.status).toBe('ai_review');
  });

  it('pede à plataforma a mídia no idioma do mercado, mantendo a música original', async () => {
    const kit = createStudioTestKit();
    const id = await aQueuedPiece(kit, 'carousel');

    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(kit.creativeStudio.requests).toEqual([
      {
        contentPieceId: id,
        format: 'carousel',
        sourceMediaUrls: ['https://cdn.example.com/ref/1.jpg', 'https://cdn.example.com/ref/2.jpg'],
        targetLocale: 'es-419',
        productName: 'San Benito',
        suggestion: null,
        keepOriginalMusic: true,
      },
    ]);
    expect(kit.localizer.requests[0]).toMatchObject({ sourceLocale: 'pt-BR', suggestion: null });
    expect(piece.currentRevision.assets).toMatchObject({ format: 'carousel' });
  });

  it('fica em producing quando a plataforma responde pending, já com a legenda guardada', async () => {
    const kit = createStudioTestKit({ creativeStudio: { mode: 'pending' } });
    const id = await aQueuedPiece(kit);

    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('producing');
    expect(piece.currentRevision.caption).toContain('👉 San Benito');
    expect(piece.currentRevision.assets).toBeNull();
    expect(kit.events.published).toEqual([]);
  });

  it('CompleteProduction conclui a produção pendente com a legenda guardada', async () => {
    const kit = createStudioTestKit({ creativeStudio: { mode: 'pending' } });
    const id = await aQueuedPiece(kit);
    const pending = await kit.produce.execute({ contentPieceId: id });

    const piece = await kit.completeProduction.execute({
      contentPieceId: id,
      assets: { format: 'reel', videoUrl: 'https://cdn.example.com/es/final.mp4', coverUrl: null },
    });

    expect(piece.status).toBe('ai_review');
    expect(piece.currentRevision.caption).toBe(pending.currentRevision.caption);
    expect(piece.currentRevision.hashtags).toEqual(pending.currentRevision.hashtags);
    expect(kit.events.typesPublished()).toEqual(['studio.content_piece_produced']);
  });

  it('CompleteProduction recusa assets de outro formato', async () => {
    const kit = createStudioTestKit({ creativeStudio: { mode: 'pending' } });
    const id = await aQueuedPiece(kit);
    await kit.produce.execute({ contentPieceId: id });

    await expect(
      kit.completeProduction.execute({
        contentPieceId: id,
        assets: { format: 'carousel', slideUrls: ['https://cdn.example.com/1.jpg'] },
      }),
    ).rejects.toMatchObject({ code: 'assets_format_mismatch' });
    expect((await kit.pieces.findById(id))!.status).toBe('producing');
  });

  it('erro da plataforma vira failProduction com o motivo', async () => {
    const kit = createStudioTestKit({
      creativeStudio: { mode: 'fail', failureMessage: 'Fila de renderização cheia.' },
    });
    const id = await aQueuedPiece(kit);

    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('failed');
    expect(piece.failureReason).toBe('Fila de renderização cheia.');
    expect(kit.events.published).toEqual([
      expect.objectContaining({
        type: 'studio.content_piece_failed',
        payload: { contentPieceId: id, reason: 'Fila de renderização cheia.' },
      }),
    ]);
    expect((await kit.pieces.findById(id))!.status).toBe('failed');
  });

  it('erro do localizador também vira falha', async () => {
    const kit = createStudioTestKit();
    const id = await aQueuedPiece(kit);
    kit.localizer.localize = async () => {
      throw new Error('Agente indisponível.');
    };

    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(piece).toMatchObject({ status: 'failed', failureReason: 'Agente indisponível.' });
    expect(kit.creativeStudio.requests).toEqual([]);
  });

  it('mercado que sumiu do diretório também vira falha', async () => {
    const kit = createStudioTestKit();
    const id = await aQueuedPiece(kit);
    kit.markets.getProfile = async () => {
      throw new Error('Mercado market-es não encontrado.');
    };

    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('failed');
  });

  it('um job repetido para uma peça já produzida é recusado sem mexer nela', async () => {
    const kit = createStudioTestKit();
    const id = await aQueuedPiece(kit);
    await kit.produce.execute({ contentPieceId: id });

    await expect(kit.produce.execute({ contentPieceId: id })).rejects.toMatchObject({
      code: 'invalid_transition',
      details: { from: 'ai_review', action: 'startProduction' },
    });
  });

  it('peça inexistente → not_found', async () => {
    const kit = createStudioTestKit();
    await expect(kit.produce.execute({ contentPieceId: 'nada' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('depois de pedir ajustes, produz a revisão 2 passando a sugestão adiante', async () => {
    const kit = createStudioTestKit();
    const id = await aQueuedPiece(kit);
    await kit.produce.execute({ contentPieceId: id });
    await kit.recordAutomatedReview.execute({
      reviewReportId: 'report-1',
      contentPieceId: id,
      revisionNumber: 1,
      score: 90,
      hasBlockingIssues: false,
    });
    await kit.decide.execute({
      contentPieceId: id,
      reviewerId: REVIEWER,
      decision: { action: 'request_changes', suggestion: 'Cite a novena no começo.' },
    });

    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('ai_review');
    expect(piece.revisions).toHaveLength(2);
    expect(piece.currentRevision.number).toBe(2);
    expect(piece.currentRevision.requestedChanges).toMatchObject({
      by: REVIEWER,
      suggestion: 'Cite a novena no começo.',
    });
    expect(piece.currentRevision.caption).toContain('Ajuste aplicado: Cite a novena no começo.');
    expect(piece.revisions[0]!.caption).not.toContain('Ajuste aplicado');
    expect(piece.currentRevision.assets).toMatchObject({
      videoUrl: 'https://cdn.example.com/ref/abc123.mp4?locale=es-419&rev=2',
    });
    expect(kit.localizer.requests.at(-1)?.suggestion).toBe('Cite a novena no começo.');
    expect(kit.creativeStudio.requests.at(-1)?.suggestion).toBe('Cite a novena no começo.');
    expect(kit.events.published.at(-1)).toMatchObject({
      type: 'studio.content_piece_produced',
      payload: { revisionNumber: 2 },
    });
  });
});

describe('RetryProduction', () => {
  it('reenfileira a produção de uma peça que falhou, e a nova tentativa pode dar certo', async () => {
    const kit = createStudioTestKit({ creativeStudio: { mode: 'fail' } });
    const id = await aQueuedPiece(kit);
    await kit.produce.execute({ contentPieceId: id });

    await kit.retryProduction.execute({ contentPieceId: id });
    expect(kit.jobs.jobs).toEqual([{ job: 'studio.produce', payload: { contentPieceId: id } }]);

    kit.creativeStudio.setMode('completed');
    const piece = await kit.produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('ai_review');
    expect(piece.revisions).toHaveLength(1);
    expect(piece.failureReason).toBeNull();
  });

  it('só vale para peças com falha', async () => {
    const kit = createStudioTestKit();
    const id = await aQueuedPiece(kit);

    await expect(kit.retryProduction.execute({ contentPieceId: id })).rejects.toMatchObject({
      code: 'invalid_transition',
      details: { from: 'queued', action: 'retryProduction' },
    });
    expect(kit.jobs.jobs).toEqual([]);
  });
});
