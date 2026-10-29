import { ContentPieceId, DomainError, PublicationId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { REVIEWER, T0, aContentPiece, aNewContentPiece, someAssets } from '../../testing/builders';
import type { ContentAssets } from './content-assets';
import { ContentPiece } from './content-piece';
import {
  CONTENT_PIECE_STATUSES,
  type ContentPieceAction,
  type ContentPieceStatus,
} from './content-piece-status';

const later = new Date('2026-10-15T13:00:00.000Z');

function caught(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('esperava um DomainError');
}

/** Como disparar cada ação com dados válidos. */
const ACTIONS: Record<ContentPieceAction, (p: ContentPiece) => void> = {
  startProduction: (p) => p.startProduction(later),
  saveLocalizedCopy: (p) => p.saveLocalizedCopy({ caption: 'Nova legenda', hashtags: [] }, later),
  logProductionStep: (p) =>
    p.logProductionStep({ kind: 'ingest', status: 'skipped', note: 'sem R2', attempts: [] }, later),
  completeProduction: (p) =>
    p.completeProduction(
      { caption: 'Oración', hashtags: ['#sanbenito'], assets: someAssets(p.format) },
      later,
    ),
  failProduction: (p) => p.failProduction('erro', later),
  recordAutomatedReview: (p) =>
    p.recordAutomatedReview({ reportId: 'r-9', score: 80, hasBlockingIssues: false }, later),
  editCaption: (p) => p.editCaption('Legenda editada', ['#fe'], REVIEWER, later),
  approve: (p) => p.approve(REVIEWER, later),
  reject: (p) => p.reject(REVIEWER, 'Fora do tom.', later),
  requestChanges: (p) => p.requestChanges(REVIEWER, 'Mais curto.', later),
  markScheduled: (p) =>
    p.markScheduled(
      { publicationId: PublicationId('pub-2'), scheduledAt: new Date('2026-10-17T16:00:00Z') },
      later,
    ),
  markPublished: (p) =>
    p.markPublished(
      {
        permalink: 'https://www.instagram.com/p/X/',
        publishedAt: new Date('2026-10-17T16:00:01Z'),
      },
      later,
    ),
  retryProduction: (p) => p.ensureRetryable(),
};

/** A tabela da máquina de estados (Docs/domain/model.md §3). */
const VALID: [ContentPieceStatus, ContentPieceAction, ContentPieceStatus][] = [
  ['queued', 'startProduction', 'producing'],
  ['changes_requested', 'startProduction', 'producing'],
  ['failed', 'startProduction', 'producing'],
  ['producing', 'saveLocalizedCopy', 'producing'],
  ['producing', 'logProductionStep', 'producing'],
  ['producing', 'completeProduction', 'ai_review'],
  ['producing', 'failProduction', 'failed'],
  ['ai_review', 'recordAutomatedReview', 'awaiting_approval'],
  ['awaiting_approval', 'editCaption', 'awaiting_approval'],
  ['awaiting_approval', 'approve', 'approved'],
  ['awaiting_approval', 'reject', 'rejected'],
  ['awaiting_approval', 'requestChanges', 'changes_requested'],
  ['approved', 'markScheduled', 'scheduled'],
  ['scheduled', 'markScheduled', 'scheduled'],
  ['scheduled', 'markPublished', 'published'],
  ['failed', 'retryProduction', 'failed'],
];

/** Ações que não são transições de status nem notas do revisor. */
const WITHOUT_HISTORY: ContentPieceAction[] = [
  'saveLocalizedCopy',
  'logProductionStep',
  'retryProduction',
];

const INVALID = (Object.keys(ACTIONS) as ContentPieceAction[]).flatMap((action) =>
  CONTENT_PIECE_STATUSES.filter((from) => !VALID.some(([f, a]) => f === from && a === action)).map(
    (from) => [from, action] as const,
  ),
);

describe('ContentPiece — máquina de estados', () => {
  it('nasce na fila, com a revisão 1 vazia, e emite content_piece_created', () => {
    const piece = ContentPiece.create(ContentPieceId('piece-1'), aNewContentPiece(), T0);

    expect(piece.status).toBe('queued');
    expect(piece.currentRevision).toMatchObject({ number: 1, caption: '', assets: null });
    expect(piece.history).toEqual([{ from: null, to: 'queued', at: T0, by: null, note: null }]);
    expect(piece.createdAt).toEqual(T0);
    expect(piece.updatedAt).toEqual(T0);
    expect(piece.pullEvents()).toEqual([
      {
        type: 'studio.content_piece_created',
        occurredAt: T0.toISOString(),
        payload: { contentPieceId: 'piece-1', referencePostId: 'post-1', marketId: 'market-es' },
      },
    ]);
  });

  it.each(VALID)('%s --%s--> %s', (from, action, to) => {
    const piece = aContentPiece({ status: from });
    const historyBefore = piece.history.length;

    ACTIONS[action](piece);

    expect(piece.status).toBe(to);
    if (WITHOUT_HISTORY.includes(action)) {
      expect(piece.history).toHaveLength(historyBefore);
    } else {
      expect(piece.history).toHaveLength(historyBefore + 1);
      expect(piece.history.at(-1)).toMatchObject({ from, to, at: later });
      expect(piece.updatedAt).toEqual(later);
    }
  });

  it.each(INVALID)('recusa %s --%s--> com invalid_transition', (from, action) => {
    const piece = aContentPiece({ status: from });
    const snapshot = piece.toSnapshot();

    const error = caught(() => ACTIONS[action](piece));

    expect(error.code).toBe('invalid_transition');
    expect(error.details).toEqual({ from, action });
    expect(piece.toSnapshot()).toEqual(snapshot);
  });
});

describe('ContentPiece — produção e revisões', () => {
  it('a partir da fila reutiliza a revisão atual', () => {
    const piece = aContentPiece({ status: 'queued' });
    piece.startProduction(later);
    expect(piece.revisions).toHaveLength(1);
  });

  it('pedir ajustes e produzir de novo cria a revisão 2 com a sugestão', () => {
    const piece = aContentPiece({ status: 'changes_requested' });
    const first = piece.currentRevision;

    piece.startProduction(later);

    expect(piece.revisions.map((r) => r.number)).toEqual([1, 2]);
    expect(piece.currentRevision).toMatchObject({
      number: 2,
      createdAt: later,
      caption: first.caption,
      assets: null,
      automatedReview: null,
      requestedChanges: { by: REVIEWER, suggestion: 'Deixe o gancho mais curto.', at: T0 },
    });
    expect(piece.revisions[0]).toEqual(first);
    expect(piece.history.at(-1)?.note).toContain('Revisão 2');
  });

  it('nova tentativa após falha reutiliza a revisão e limpa o motivo da falha', () => {
    const piece = aContentPiece({ status: 'changes_requested' });
    piece.startProduction(later);
    piece.failProduction('timeout', later);
    expect(piece.failureReason).toBe('timeout');

    piece.startProduction(later);

    expect(piece.revisions).toHaveLength(2);
    expect(piece.currentRevision.requestedChanges?.suggestion).toBe('Deixe o gancho mais curto.');
    expect(piece.failureReason).toBeNull();
  });

  it('concluir a produção grava legenda, hashtags normalizadas e assets, e emite produced', () => {
    const piece = aContentPiece({ status: 'producing' });

    piece.completeProduction(
      {
        caption: '  Oración de San Benito  ',
        hashtags: ['sanbenito', '#SanBenito', ' #fe ', ''],
        assets: someAssets('reel'),
      },
      later,
    );

    expect(piece.currentRevision).toMatchObject({
      caption: 'Oración de San Benito',
      hashtags: ['#sanbenito', '#fe'],
      assets: someAssets('reel'),
    });
    expect(piece.pullEvents()).toEqual([
      {
        type: 'studio.content_piece_produced',
        occurredAt: later.toISOString(),
        payload: { contentPieceId: 'piece-1', marketId: 'market-es', revisionNumber: 1 },
      },
    ]);
  });

  it('exige assets do mesmo formato da peça', () => {
    const piece = aContentPiece({ status: 'producing', format: 'carousel' });
    const error = caught(() =>
      piece.completeProduction({ caption: 'x', hashtags: [], assets: someAssets('reel') }, later),
    );
    expect(error.code).toBe('assets_format_mismatch');
    expect(piece.status).toBe('producing');
  });

  it.each<[string, ContentAssets]>([
    ['carrossel sem slides', { format: 'carousel', slideUrls: [] }],
    ['vídeo com link inválido', { format: 'reel', videoUrl: 'não é url', coverUrl: null }],
    [
      'capa fora de http(s)',
      { format: 'reel', videoUrl: 'https://a.b/v.mp4', coverUrl: 'ftp://x' },
    ],
  ])('recusa assets inválidos: %s', (_label, assets) => {
    const piece = aContentPiece({ status: 'producing', format: assets.format });
    const error = caught(() =>
      piece.completeProduction({ caption: 'x', hashtags: [], assets }, later),
    );
    expect(error.code).toBe('invalid_assets');
  });

  it('recusa concluir com legenda vazia', () => {
    const piece = aContentPiece({ status: 'producing' });
    const error = caught(() =>
      piece.completeProduction({ caption: '   ', hashtags: [], assets: someAssets() }, later),
    );
    expect(error.code).toBe('invalid_caption');
  });

  it('falha de produção guarda o motivo e emite content_piece_failed', () => {
    const piece = aContentPiece({ status: 'producing' });
    piece.failProduction('  A plataforma caiu.  ', later);

    expect(piece.failureReason).toBe('A plataforma caiu.');
    expect(piece.history.at(-1)).toMatchObject({ to: 'failed', note: 'A plataforma caiu.' });
    expect(piece.pullEvents()).toEqual([
      {
        type: 'studio.content_piece_failed',
        occurredAt: later.toISOString(),
        payload: { contentPieceId: 'piece-1', reason: 'A plataforma caiu.' },
      },
    ]);
  });

  it('registra o resumo da revisão automática na revisão atual', () => {
    const piece = aContentPiece({ status: 'ai_review' });
    piece.recordAutomatedReview({ reportId: 'r-1', score: 65, hasBlockingIssues: true }, later);

    expect(piece.currentRevision.automatedReview).toEqual({
      reportId: 'r-1',
      score: 65,
      hasBlockingIssues: true,
    });
    expect(piece.history.at(-1)?.note).toContain('bloqueantes');
    expect(piece.pullEvents()).toEqual([]);
  });

  it('recusa nota de revisão fora de 0–100', () => {
    const piece = aContentPiece({ status: 'ai_review' });
    const error = caught(() =>
      piece.recordAutomatedReview({ reportId: 'r', score: 120, hasBlockingIssues: false }, later),
    );
    expect(error.code).toBe('invalid_review_score');
  });
});

describe('ContentPiece — decisão do revisor', () => {
  it('aprova e emite content_piece_approved', () => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    piece.approve(REVIEWER, later);

    expect(piece.history.at(-1)).toMatchObject({ to: 'approved', by: REVIEWER });
    expect(piece.pullEvents()).toEqual([
      {
        type: 'studio.content_piece_approved',
        occurredAt: later.toISOString(),
        payload: {
          contentPieceId: 'piece-1',
          marketId: 'market-es',
          channelId: 'channel-es',
          format: 'reel',
          approvedBy: REVIEWER,
        },
      },
    ]);
  });

  it('não aprova com problemas bloqueantes na revisão automática', () => {
    const piece = aContentPiece({ status: 'ai_review' });
    piece.recordAutomatedReview({ reportId: 'r-1', score: 50, hasBlockingIssues: true }, later);

    expect(caught(() => piece.approve(REVIEWER, later)).code).toBe('blocking_issues_unresolved');
    expect(piece.status).toBe('awaiting_approval');
  });

  it('não aprova sem assets', () => {
    const snapshot = aContentPiece({ status: 'awaiting_approval' }).toSnapshot();
    const current = snapshot.revisions.at(-1)!;
    current.assets = null;
    const piece = ContentPiece.fromSnapshot(snapshot);

    expect(caught(() => piece.approve(REVIEWER, later)).code).toBe('assets_missing');
  });

  it('reprova com motivo e emite content_piece_rejected', () => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    piece.reject(REVIEWER, '  Promete milagre.  ', later);

    expect(piece.history.at(-1)).toMatchObject({ to: 'rejected', note: 'Promete milagre.' });
    expect(piece.pullEvents()[0]).toMatchObject({
      type: 'studio.content_piece_rejected',
      payload: { contentPieceId: 'piece-1', rejectedBy: REVIEWER, reason: 'Promete milagre.' },
    });
  });

  it('pede ajustes e emite content_piece_changes_requested', () => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    piece.requestChanges(REVIEWER, 'Use "fe" em vez de "creencia".', later);

    expect(piece.revisions).toHaveLength(1);
    expect(piece.pullEvents()[0]).toMatchObject({
      type: 'studio.content_piece_changes_requested',
      payload: {
        contentPieceId: 'piece-1',
        requestedBy: REVIEWER,
        suggestion: 'Use "fe" em vez de "creencia".',
      },
    });
  });

  it.each(['', '  ', 'ok', ' a  '])('recusa motivo de reprovação curto: %j', (reason) => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    expect(caught(() => piece.reject(REVIEWER, reason, later)).code).toBe(
      'invalid_rejection_reason',
    );
    expect(piece.status).toBe('awaiting_approval');
  });

  it.each(['', 'no', ' ab '])('recusa sugestão de ajuste curta: %j', (suggestion) => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    expect(caught(() => piece.requestChanges(REVIEWER, suggestion, later)).code).toBe(
      'invalid_change_suggestion',
    );
  });

  it('editar a legenda não muda o status, mas fica no histórico', () => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    piece.editCaption(' Nueva leyenda ', ['oracion'], REVIEWER, later);

    expect(piece.status).toBe('awaiting_approval');
    expect(piece.currentRevision).toMatchObject({
      caption: 'Nueva leyenda',
      hashtags: ['#oracion'],
    });
    expect(piece.history.at(-1)).toMatchObject({
      from: 'awaiting_approval',
      to: 'awaiting_approval',
      by: REVIEWER,
      note: 'Legenda editada pelo revisor.',
    });
    expect(piece.pullEvents()).toEqual([]);
  });

  it('a revisão automática refeita sobre a legenda editada passa a valer (e pode bloquear)', () => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    piece.editCaption('Cura garantizada', [], REVIEWER, later, {
      reportId: 'r-edit',
      score: 75,
      hasBlockingIssues: true,
    });

    expect(piece.currentRevision.automatedReview).toEqual({
      reportId: 'r-edit',
      score: 75,
      hasBlockingIssues: true,
    });
    expect(piece.history.at(-1)?.note).toBe(
      'Legenda editada pelo revisor. Revisão automática refeita: nota 75, com problemas bloqueantes.',
    );
    expect(caught(() => piece.approve(REVIEWER, later)).code).toBe('blocking_issues_unresolved');
  });

  it('recusa revisão da legenda editada com nota inválida', () => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    expect(
      caught(() =>
        piece.editCaption('Nueva', [], REVIEWER, later, {
          reportId: 'r',
          score: 120,
          hasBlockingIssues: false,
        }),
      ).code,
    ).toBe('invalid_review_score');
  });

  it('sabe se a legenda e as hashtags já são estas (como ficariam salvas)', () => {
    const piece = aContentPiece({ status: 'awaiting_approval' });
    piece.editCaption('Nueva leyenda', ['oracion', 'fe'], REVIEWER, later);

    expect(piece.hasCaption('  Nueva leyenda ', ['#oracion', 'fe', 'Fe'])).toBe(true);
    expect(piece.hasCaption('Nueva leyenda!', ['oracion', 'fe'])).toBe(false);
    expect(piece.hasCaption('Nueva leyenda', ['fe', 'oracion'])).toBe(false);
  });
});

describe('ContentPiece — publicação', () => {
  it('agenda, reagenda e publica', () => {
    const piece = aContentPiece({ status: 'approved' });
    const first = new Date('2026-10-16T16:00:00.000Z');
    const second = new Date('2026-10-17T02:00:00.000Z');

    piece.markScheduled({ publicationId: PublicationId('pub-1'), scheduledAt: first }, later);
    piece.markScheduled({ publicationId: PublicationId('pub-1'), scheduledAt: second }, later);

    expect(piece.publication).toMatchObject({
      id: 'pub-1',
      scheduledAt: second,
      status: 'scheduled',
    });
    expect(piece.history.at(-1)?.note).toContain('Reagendada');

    const publishedAt = new Date('2026-10-17T02:00:03.000Z');
    piece.markPublished({ permalink: 'https://www.instagram.com/p/ES1/', publishedAt }, later);

    expect(piece.status).toBe('published');
    expect(piece.publication).toEqual({
      id: 'pub-1',
      scheduledAt: second,
      status: 'published',
      permalink: 'https://www.instagram.com/p/ES1/',
      publishedAt,
    });
  });
});

describe('ContentPiece — snapshot', () => {
  it('sobrevive a ida e volta pelo snapshot em qualquer ponto do ciclo', () => {
    const piece = aContentPiece({ status: 'changes_requested' });
    piece.startProduction(later);
    expect(ContentPiece.fromSnapshot(piece.toSnapshot()).toSnapshot()).toEqual(piece.toSnapshot());

    const published = aContentPiece({ status: 'published', format: 'carousel' });
    expect(ContentPiece.fromSnapshot(published.toSnapshot()).toSnapshot()).toEqual(
      published.toSnapshot(),
    );
  });

  it('guarda o pedido de ajustes pendente entre a decisão e a nova produção', () => {
    const piece = aContentPiece({ status: 'changes_requested' });
    const restored = ContentPiece.fromSnapshot(piece.toSnapshot());

    restored.startProduction(later);

    expect(restored.currentRevision.requestedChanges?.suggestion).toBe(
      'Deixe o gancho mais curto.',
    );
    expect(restored.toSnapshot().pendingChangeRequest).toBeNull();
  });

  it('recusa snapshot sem revisões', () => {
    const snapshot = aContentPiece().toSnapshot();
    snapshot.revisions = [];
    expect(caught(() => ContentPiece.fromSnapshot(snapshot)).code).toBe('corrupted_content_piece');
  });

  it('não compartilha arrays com quem criou a peça', () => {
    const props = aNewContentPiece();
    const piece = ContentPiece.create(ContentPieceId('p'), props, T0);
    props.source.mediaUrls.push('https://cdn.example.com/x.mp4');
    expect(piece.source.mediaUrls).toHaveLength(1);
  });
});
