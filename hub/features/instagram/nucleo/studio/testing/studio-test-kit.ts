import {
  FixedClock,
  RecordingEventBus,
  RecordingJobQueue,
  SequentialIdGenerator,
} from '@sbs/shared-kernel/testing';
import {
  CompleteProduction,
  CreateAdaptations,
  DecideOnContentPiece,
  EditCaption,
  GetContentPiece,
  ListContentPieces,
  MarkPublished,
  MarkScheduled,
  ProduceContentPiece,
  RecordAutomatedReview,
  RetryProduction,
} from '../application';
import {
  FakeCopyLocalizer,
  FakeCreativeStudio,
  InMemoryContentPieceRepository,
  type FakeCreativeStudioOptions,
} from '../infrastructure';
import { aMarketProfile } from './builders';
import { InMemoryMarketDirectory } from './in-memory-market-directory';

/**
 * Estúdio completo em memória (repositório, fakes, relógio fixo, barramento e fila que
 * só registram), com todos os casos de uso já montados.
 */
export function createStudioTestKit(options: { creativeStudio?: FakeCreativeStudioOptions } = {}) {
  const pieces = new InMemoryContentPieceRepository();
  const markets = new InMemoryMarketDirectory().add(aMarketProfile(), 'channel-es').add(
    aMarketProfile({
      marketId: 'market-fr',
      name: 'Francês',
      locale: 'fr-FR',
      timezone: 'Europe/Paris',
      productName: 'Saint Benoît',
      offerUrl: 'https://saintbenoit.example.com/offre',
      glossary: [{ source: 'São Bento', target: 'Saint Benoît' }],
    }),
    'channel-fr',
  );
  const localizer = new FakeCopyLocalizer();
  const creativeStudio = new FakeCreativeStudio(options.creativeStudio);
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator('piece');
  const events = new RecordingEventBus();
  const jobs = new RecordingJobQueue();

  return {
    pieces,
    markets,
    localizer,
    creativeStudio,
    clock,
    ids,
    events,
    jobs,
    createAdaptations: new CreateAdaptations(pieces, markets, ids, clock, events, jobs),
    produce: new ProduceContentPiece(pieces, markets, localizer, creativeStudio, clock, events),
    completeProduction: new CompleteProduction(pieces, clock, events),
    recordAutomatedReview: new RecordAutomatedReview(pieces, clock, events),
    decide: new DecideOnContentPiece(pieces, clock, events, jobs),
    editCaption: new EditCaption(pieces, clock),
    retryProduction: new RetryProduction(pieces, jobs),
    markScheduled: new MarkScheduled(pieces, clock),
    markPublished: new MarkPublished(pieces, clock),
    getContentPiece: new GetContentPiece(pieces),
    listContentPieces: new ListContentPieces(pieces),
  };
}

export type StudioTestKit = ReturnType<typeof createStudioTestKit>;
