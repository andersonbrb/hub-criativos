import type {
  AutomatedReviewCompleted,
  EventBus,
  EventHandler,
  PublicationPublished,
  PublicationRescheduled,
  PublicationScheduled,
  ReferencePostSelected,
} from '@sbs/shared-kernel';
import type { CreateAdaptations } from '../use-cases/create-adaptations';
import type { MarkPublished } from '../use-cases/mark-published';
import type { MarkScheduled } from '../use-cases/mark-scheduled';
import type { RecordAutomatedReview } from '../use-cases/record-automated-review';

export function onReferencePostSelected(
  useCase: CreateAdaptations,
): EventHandler<ReferencePostSelected> {
  return async (event) => {
    await useCase.execute(event.payload);
  };
}

export function onAutomatedReviewCompleted(
  useCase: RecordAutomatedReview,
): EventHandler<AutomatedReviewCompleted> {
  return async (event) => {
    await useCase.execute(event.payload);
  };
}

/** Serve para `publication_scheduled` e `publication_rescheduled` (mesmo payload). */
export function onPublicationScheduled(
  useCase: MarkScheduled,
): EventHandler<PublicationScheduled | PublicationRescheduled> {
  return async (event) => {
    await useCase.execute(event.payload);
  };
}

export function onPublicationPublished(useCase: MarkPublished): EventHandler<PublicationPublished> {
  return async (event) => {
    await useCase.execute(event.payload);
  };
}

export interface StudioEventHandlerUseCases {
  createAdaptations: CreateAdaptations;
  recordAutomatedReview: RecordAutomatedReview;
  markScheduled: MarkScheduled;
  markPublished: MarkPublished;
}

/** Assina no barramento os eventos de outros contextos aos quais o Estúdio reage. */
export function subscribeStudioEventHandlers(
  bus: EventBus,
  useCases: StudioEventHandlerUseCases,
): void {
  bus.subscribe<ReferencePostSelected>(
    'reference.post_selected',
    onReferencePostSelected(useCases.createAdaptations),
  );
  bus.subscribe<AutomatedReviewCompleted>(
    'governance.automated_review_completed',
    onAutomatedReviewCompleted(useCases.recordAutomatedReview),
  );
  bus.subscribe<PublicationScheduled>(
    'publishing.publication_scheduled',
    onPublicationScheduled(useCases.markScheduled),
  );
  bus.subscribe<PublicationRescheduled>(
    'publishing.publication_rescheduled',
    onPublicationScheduled(useCases.markScheduled),
  );
  bus.subscribe<PublicationPublished>(
    'publishing.publication_published',
    onPublicationPublished(useCases.markPublished),
  );
}
