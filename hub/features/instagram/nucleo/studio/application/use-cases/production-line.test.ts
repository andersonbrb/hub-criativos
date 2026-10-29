import { describe, expect, it } from 'vitest';
import type { ProductionStepKind } from '../../domain';
import { REVIEWER, aReferencePostSelectedPayload, createStudioTestKit } from '../../testing';
import type {
  ProductionContext,
  ProductionLine,
  ProductionReviewer,
  ProductionSpecialist,
  SpecialistResult,
} from '../ports/production-line';
import { ProduceContentPiece } from './produce-content-piece';

/** Especialista controlado pelo teste: cada chamada devolve um vídeo novo. */
class StubSpecialist implements ProductionSpecialist {
  readonly feedbacks: (string | null)[] = [];
  constructor(
    readonly kind: ProductionStepKind,
    private readonly options: { skip?: string; fail?: string } = {},
  ) {}
  async skipReason() {
    return this.options.skip ?? null;
  }
  async run(context: ProductionContext, feedback: string | null): Promise<SpecialistResult> {
    this.feedbacks.push(feedback);
    if (this.options.fail) throw new Error(this.options.fail);
    const n = this.feedbacks.length;
    return {
      media: { mediaUrls: [`https://r2.example.com/${this.kind}-${n}.mp4`], coverUrl: null },
      summary: `${this.kind} tentativa ${n} a partir de ${context.media.mediaUrls[0]}`,
    };
  }
}

/** Revisor que reprova as primeiras `rejections` tentativas. */
class StubReviewer implements ProductionReviewer {
  calls = 0;
  constructor(private readonly rejections: number) {}
  async review() {
    this.calls += 1;
    return this.calls <= this.rejections
      ? { approved: false, notes: `Ajuste ${this.calls}: sobrou legenda.` }
      : { approved: true, notes: 'Limpo.' };
  }
}

async function setup(line: ProductionLine) {
  const kit = createStudioTestKit();
  const produce = new ProduceContentPiece(
    kit.pieces,
    kit.markets,
    kit.localizer,
    kit.creativeStudio,
    kit.clock,
    kit.events,
    { productionLine: line },
  );
  const [piece] = await kit.createAdaptations.execute(aReferencePostSelectedPayload());
  return { kit, produce, id: piece!.id };
}

const lineOf = (...stages: Awaited<ReturnType<ProductionLine['stagesFor']>>): ProductionLine => ({
  stagesFor: async () => stages,
});

describe('linha de produção (especialista → revisor, até 3 tentativas)', () => {
  it('reprovou, volta com o motivo; aprovado, a mídia segue para a próxima etapa', async () => {
    const ingest = new StubSpecialist('ingest');
    const subtitles = new StubSpecialist('subtitle_removal');
    const { kit, produce, id } = await setup(
      lineOf(
        { specialist: ingest, reviewer: new StubReviewer(0) },
        { specialist: subtitles, reviewer: new StubReviewer(1) },
      ),
    );

    const piece = await produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('ai_review');
    expect(subtitles.feedbacks).toEqual([null, 'Ajuste 1: sobrou legenda.']);
    // A segunda etapa recebe a mídia aprovada na primeira; a da última vira a mídia final.
    expect(piece.currentRevision.assets).toEqual({
      format: 'reel',
      videoUrl: 'https://r2.example.com/subtitle_removal-2.mp4',
      coverUrl: null,
    });
    expect(kit.creativeStudio.requests).toEqual([]);
    const production = piece.currentRevision.production;
    expect(production.map((s) => [s.kind, s.status, s.attempts.length])).toEqual([
      ['ingest', 'approved', 1],
      ['subtitle_removal', 'approved', 2],
      ['caption', 'approved', 1],
      ['creative', 'skipped', 0],
    ]);
    expect(production[1]!.attempts[0]!.review).toEqual({
      approved: false,
      notes: 'Ajuste 1: sobrou legenda.',
    });
    expect(production[1]!.attempts[1]!.summary).toContain('ingest-1.mp4');
  });

  it('reprovada 3 vezes: a peça para e espera decisão humana, com o último parecer', async () => {
    const { kit, produce, id } = await setup(
      lineOf({ specialist: new StubSpecialist('editing'), reviewer: new StubReviewer(5) }),
    );

    const piece = await produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('failed');
    expect(piece.failureReason).toBe(
      'Edição reprovada 3 vezes pelo revisor. Último parecer: Ajuste 3: sobrou legenda.',
    );
    expect(piece.currentRevision.production).toEqual([
      expect.objectContaining({ kind: 'editing', status: 'rejected' }),
    ]);
    expect(kit.creativeStudio.requests).toEqual([]);
  });

  it('erro do especialista para a produção na hora, com o motivo', async () => {
    const { produce, id } = await setup(
      lineOf({
        specialist: new StubSpecialist('video_translation', { fail: 'HeyGen sem créditos' }),
        reviewer: new StubReviewer(0),
      }),
    );

    const piece = await produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('failed');
    expect(piece.failureReason).toBe('Tradução do vídeo: HeyGen sem créditos');
    expect(piece.currentRevision.production[0]).toMatchObject({
      status: 'failed',
      attempts: [{ error: 'HeyGen sem créditos' }],
    });
  });

  it('etapa sem integração conectada é pulada, com o motivo, e a produção segue', async () => {
    const { produce, id } = await setup(
      lineOf({
        specialist: new StubSpecialist('subtitle_removal', { skip: 'vMake não conectado.' }),
        reviewer: new StubReviewer(0),
      }),
    );

    const piece = await produce.execute({ contentPieceId: id });

    expect(piece.status).toBe('ai_review');
    expect(piece.currentRevision.production[0]).toEqual({
      kind: 'subtitle_removal',
      status: 'skipped',
      note: 'vMake não conectado.',
      attempts: [],
      output: null,
    });
  });
});

describe('reprovar e voltar para edição', () => {
  it('reaproveita as etapas antes da edição e refaz a edição com o pedido do social media', async () => {
    const ingest = new StubSpecialist('ingest');
    const translation = new StubSpecialist('video_translation');
    const editing = new StubSpecialist('editing');
    const suggestions: (string | null)[] = [];
    const watchingEditing: ProductionSpecialist = {
      kind: 'editing',
      skipReason: async () => null,
      run: async (context, feedback) => {
        suggestions.push(context.suggestion);
        return editing.run(context, feedback);
      },
    };
    const { kit, produce, id } = await setup(
      lineOf(
        { specialist: ingest, reviewer: new StubReviewer(0) },
        { specialist: translation, reviewer: new StubReviewer(0) },
        { specialist: watchingEditing, reviewer: new StubReviewer(0) },
      ),
    );
    await produce.execute({ contentPieceId: id });
    await kit.recordAutomatedReview.execute({
      contentPieceId: id,
      revisionNumber: 1,
      reviewReportId: 'r1',
      score: 90,
      hasBlockingIssues: false,
    });
    await kit.decide.execute({
      contentPieceId: id,
      reviewerId: REVIEWER,
      decision: { action: 'request_changes', suggestion: 'O CTA está cobrindo o rosto.' },
    });

    const piece = await produce.execute({ contentPieceId: id });

    // Tradução e armazenamento não rodam de novo; a edição roda com o pedido.
    expect(ingest.feedbacks).toHaveLength(1);
    expect(translation.feedbacks).toHaveLength(1);
    expect(suggestions).toEqual([null, 'O CTA está cobrindo o rosto.']);
    expect(editing.feedbacks).toHaveLength(2);
    const production = piece.currentRevision.production;
    expect(production.map((s) => [s.kind, s.status])).toEqual([
      ['ingest', 'approved'],
      ['video_translation', 'approved'],
      ['editing', 'approved'],
      ['caption', 'approved'],
      ['creative', 'skipped'],
    ]);
    expect(production[1]!.note).toBe('Reaproveitada da revisão 1: o pedido voltou para a edição.');
    // A edição parte do vídeo traduzido na revisão 1.
    expect(production[2]!.attempts[0]!.summary).toContain('video_translation-1.mp4');
    expect(piece.currentRevision.assets).toMatchObject({
      videoUrl: 'https://r2.example.com/editing-2.mp4',
    });
  });
});
