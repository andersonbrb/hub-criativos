import { describe, expect, it } from 'vitest';
import { aContentPiece } from '../../testing';
import { ContentPiece } from './content-piece';
import type { ProductionStep, StepAttempt } from './production-step';

const now = new Date('2026-10-20T12:00:00.000Z');

const attempt = (number: number, approved: boolean): StepAttempt => ({
  number,
  startedAt: now,
  finishedAt: now,
  summary: `tentativa ${number}`,
  outputUrls: [`https://media.example.com/${number}.mp4`],
  review: { approved, notes: approved ? 'Ok.' : 'Sobrou legenda no rodapé.' },
  error: null,
});

const step = (overrides: Partial<ProductionStep> = {}): ProductionStep => ({
  kind: 'ingest',
  status: 'approved',
  note: null,
  attempts: [attempt(1, true)],
  ...overrides,
});

describe('ContentPiece — registro de produção', () => {
  it('registra a etapa; registrar de novo a mesma etapa substitui (uma por tipo)', () => {
    const piece = aContentPiece({ status: 'producing' });

    piece.logProductionStep(step({ status: 'running', attempts: [] }), now);
    piece.logProductionStep(step({ kind: 'caption' }), now);
    piece.logProductionStep(step({ attempts: [attempt(1, false), attempt(2, true)] }), now);

    const production = piece.currentRevision.production;
    expect(production.map((s) => [s.kind, s.status, s.attempts.length])).toEqual([
      ['ingest', 'approved', 2],
      ['caption', 'approved', 1],
    ]);
    expect(production[0]!.attempts[0]!.review).toEqual({
      approved: false,
      notes: 'Sobrou legenda no rodapé.',
    });
  });

  it('no máximo 3 tentativas por etapa', () => {
    const piece = aContentPiece({ status: 'producing' });
    expect(() =>
      piece.logProductionStep(
        step({ attempts: [1, 2, 3, 4].map((n) => attempt(n, false)), status: 'rejected' }),
        now,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_production_step' }));
  });

  it('cada nova produção começa um registro vazio', () => {
    const piece = aContentPiece({ status: 'producing' });
    piece.logProductionStep(step(), now);
    piece.failProduction('HeyGen fora do ar', now);

    piece.startProduction(now);

    expect(piece.currentRevision.production).toEqual([]);
  });

  it('sobrevive ao snapshot; revisões antigas (sem registro) leem como vazio', () => {
    const piece = aContentPiece({ status: 'producing' });
    piece.logProductionStep(step(), now);
    const snapshot = piece.toSnapshot();

    expect(ContentPiece.fromSnapshot(snapshot).currentRevision.production).toEqual(
      piece.currentRevision.production,
    );

    const legacy = structuredClone(snapshot);
    for (const revision of legacy.revisions) delete revision.production;
    expect(ContentPiece.fromSnapshot(legacy).currentRevision.production).toEqual([]);
  });
});
