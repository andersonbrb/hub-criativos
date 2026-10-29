import {
  FakeContentReviewer,
  GetLatestReviewReport,
  ReviewEditedCaption,
  RunAutomatedReview,
  onContentPieceProduced,
  type ContentReviewer,
} from '@sbs/governance';
import {
  CreateChannel,
  CreateMarket,
  MarketDirectoryQuery,
  UpdateMarket,
  ChangeChannelConnection,
  ChangeChannelMarket,
  LinkInstagramAccount,
  UpdatePostingPlan,
} from '@sbs/markets';
import {
  CancelPublication,
  FakeSocialPublisher,
  ListPublications,
  PublishDuePublications,
  ReschedulePublication,
  SchedulePublication,
  onContentPieceApproved,
  type SocialPublisher,
} from '@sbs/publishing';
import {
  ChangeReferenceSourceConnection,
  FakeReferenceFeed,
  IgnoreReferencePost,
  ListReferencePosts,
  ListReferenceSources,
  RegisterAdaptation,
  RegisterReferenceSource,
  SelectReferencePost,
  SelectTopPerformers,
  SyncReferenceFeed,
  type ReferenceFeed,
} from '@sbs/reference';
import type { Clock, DomainEvent, IdGenerator } from '@sbs/shared-kernel';
import {
  CompleteProduction,
  CreateAdaptations,
  DecideOnContentPiece,
  EditCaption,
  FakeCopyLocalizer,
  FakeCreativeStudio,
  GetContentPiece,
  ListContentPieces,
  MarkPublished,
  MarkScheduled,
  ProduceContentPiece,
  RecordAutomatedReview,
  RetryProduction,
  UpdateEditingStandard,
  StudioJobs,
  subscribeStudioEventHandlers,
  type CopyLocalizer,
  type CreativeStudio,
  type ProduceJobPayload,
} from '@sbs/studio';
import { currentDatabase, type Database } from '../infrastructure/database/postgres-document-store';
import { PersistentEventBus } from '../infrastructure/events/persistent-event-bus';
import { InProcessJobQueue } from '../infrastructure/jobs/in-process-job-queue';
import { PostgresReviewReportRepository } from '../infrastructure/persistence/governance-repositories';
import {
  PostgresChannelRepository,
  PostgresMarketRepository,
} from '../infrastructure/persistence/markets-repositories';
import { PostgresPublicationRepository } from '../infrastructure/persistence/publishing-repositories';
import {
  PostgresReferencePostRepository,
  PostgresReferenceSourceRepository,
} from '../infrastructure/persistence/reference-repositories';
import {
  PostgresContentPieceRepository,
  PostgresEditingStandardRepository,
} from '../infrastructure/persistence/studio-repositories';
import {
  GovernanceContentForReview,
  PublishingChannelDirectory,
  PublishingContentSource,
  ReferenceAdaptationTracker,
  StudioMarketDirectory,
} from './cross-context-adapters';
import { DashboardQuery } from './dashboard-query';
import { DemoDataCleanup } from './demo-data';
import { SecretBox } from '../infrastructure/integrations/secret-box';
import { dynamicAdapters } from './dynamic-adapters';
import { hubFetch, MediaStorage, type MediaStorageConfig } from './media-storage';
import type { HubTranscriber, VideoRenderer } from '../infrastructure/integrations/hub-tools';
import { InstagramSocialPublisher } from './instagram-publisher';
import { ProductionGeneralReviewer } from './production/general-reviewer';
import { productionLine, productionTools } from './production/production-line';
import { IntegrationsService, type IntegrationsConfig } from './integrations';
import { GuardedEditCaption } from './guarded-edit-caption';

interface Logger {
  error(obj: unknown, msg?: string): void;
}

/**
 * Integrações externas. Leitura das referências (Apify), tradução e revisão (Claude) são
 * reais quando conectadas na central de integrações; criativos e publicação ainda são falsos.
 */
export interface ExternalAdapters {
  referenceFeed: ReferenceFeed;
  copyLocalizer: CopyLocalizer;
  creativeStudio: CreativeStudio;
  contentReviewer: ContentReviewer;
  socialPublisher: SocialPublisher;
}

export function fakeAdapters(): ExternalAdapters {
  return {
    referenceFeed: new FakeReferenceFeed(),
    copyLocalizer: new FakeCopyLocalizer(),
    creativeStudio: new FakeCreativeStudio(),
    contentReviewer: new FakeContentReviewer(),
    socialPublisher: new FakeSocialPublisher(),
  };
}

export interface PlatformConfig {
  production: boolean;
  referencePostsLimit: number;
  /** As chaves e os logins do hub (Integrações) e o endereço público (retorno do login do Instagram). */
  integrations: IntegrationsConfig;
  /** Endereço público do hub e a chave das assinaturas dos links `/api/instagram/midia/...`. */
  media: MediaStorageConfig;
  /** Editor de vídeo (servidor de edições). Sem ele, a etapa de edição é pulada. */
  videoRenderer?: (media: MediaStorage) => VideoRenderer;
  /** Transcrição (Whisper do hub). `null`: sem transcrição (testes). */
  transcriber?: ((media: MediaStorage) => HubTranscriber) | null;
}

/**
 * Composition root: o único lugar que conhece todos os contextos. Monta repositórios,
 * adaptadores, casos de uso e a fiação de eventos e jobs entre contextos.
 */
export function createContainer(deps: {
  /** Banco do hub, lido a cada uso (os testes trocam). */
  db?: () => Database;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  adapters?: ExternalAdapters;
  platform: PlatformConfig;
}) {
  const { clock, ids, logger } = deps;
  const db = deps.db ?? currentDatabase;
  const events = new PersistentEventBus(db);
  const jobs = new InProcessJobQueue(logger);

  // ── repositórios ──────────────────────────────────────────────────────────
  const marketRepo = new PostgresMarketRepository(db);
  const channelRepo = new PostgresChannelRepository(db);
  const sourceRepo = new PostgresReferenceSourceRepository(db);
  const postRepo = new PostgresReferencePostRepository(db);
  const pieceRepo = new PostgresContentPieceRepository(db);
  const editingStandardRepo = new PostgresEditingStandardRepository(db);
  const reportRepo = new PostgresReviewReportRepository(db);
  const publicationRepo = new PostgresPublicationRepository(db);

  const marketDirectory = new MarketDirectoryQuery(marketRepo, channelRepo);

  // ── markets ───────────────────────────────────────────────────────────────
  const markets = {
    repo: marketRepo,
    channels: channelRepo,
    directory: marketDirectory,
    createMarket: new CreateMarket(marketRepo, ids, clock, events),
    updateMarket: new UpdateMarket(marketRepo, events),
    createChannel: new CreateChannel(marketRepo, channelRepo, ids, clock, events),
    updatePostingPlan: new UpdatePostingPlan(channelRepo),
    changeChannelConnection: new ChangeChannelConnection(channelRepo),
    linkInstagramAccount: new LinkInstagramAccount(marketRepo, channelRepo, ids, clock, events),
    changeChannelMarket: new ChangeChannelMarket(marketRepo, channelRepo),
  };

  // ── integrações (credenciais salvas no painel, cifradas) ──────────────────
  const platform = deps.platform;
  const media = new MediaStorage(platform.media);
  // O link da própria mídia é servido aqui mesmo; o resto vai pela rede (ou pelo fetch simulado dos testes).
  const fetchFn = hubFetch(media, platform.integrations.fetch ?? fetch);
  const integrations = new IntegrationsService(db, new SecretBox(), clock, markets, {
    ...platform.integrations,
    fetch: fetchFn,
  });
  const adapters: ExternalAdapters = deps.adapters ?? {
    ...fakeAdapters(),
    ...dynamicAdapters(integrations, {
      production: platform.production,
      resultsLimit: platform.referencePostsLimit,
      fetch: fetchFn,
    }),
  };

  // ── reference ─────────────────────────────────────────────────────────────
  const adaptationTracker = new ReferenceAdaptationTracker(pieceRepo);
  const reference = {
    registerSource: new RegisterReferenceSource(sourceRepo, ids),
    listSources: new ListReferenceSources(sourceRepo),
    changeConnection: new ChangeReferenceSourceConnection(sourceRepo),
    sync: new SyncReferenceFeed(sourceRepo, postRepo, adapters.referenceFeed, ids, clock),
    selectTop: new SelectTopPerformers(postRepo, clock, events),
    select: new SelectReferencePost(postRepo, clock, events, adaptationTracker),
    adaptations: adaptationTracker,
    ignore: new IgnoreReferencePost(postRepo),
    listPosts: new ListReferencePosts(postRepo),
    registerAdaptation: new RegisterAdaptation(postRepo),
  };

  // Ferramentas dos agentes de produção (HeyGen, ElevenLabs, FLORA, Claude, Remotion).
  const tools = productionTools({
    integrations,
    media,
    editingStandards: editingStandardRepo,
    renderer: platform.videoRenderer?.(media) ?? null,
    ...(platform.transcriber === null ? { transcriber: null } : platform.transcriber ? { transcriber: platform.transcriber(media) } : {}),
    fetch: fetchFn,
  });

  // A governança lê a peça (studio + markets); a legenda editada passa pela mesma revisão.
  const contentForReview = new GovernanceContentForReview(pieceRepo, marketDirectory);
  const reviewEditedCaption = new ReviewEditedCaption(
    reportRepo,
    contentForReview,
    adapters.contentReviewer,
    ids,
    clock,
    events,
  );

  // ── studio ────────────────────────────────────────────────────────────────
  const studioMarkets = new StudioMarketDirectory(marketDirectory);
  const editCaption = new EditCaption(pieceRepo, clock);
  const studio = {
    repo: pieceRepo,
    createAdaptations: new CreateAdaptations(pieceRepo, studioMarkets, ids, clock, events, jobs),
    produce: new ProduceContentPiece(
      pieceRepo,
      studioMarkets,
      adapters.copyLocalizer,
      adapters.creativeStudio,
      clock,
      events,
      {
        productionLine: productionLine(tools),
      },
    ),
    completeProduction: new CompleteProduction(pieceRepo, clock, events),
    recordAutomatedReview: new RecordAutomatedReview(pieceRepo, clock, events),
    decide: new DecideOnContentPiece(pieceRepo, clock, events, jobs),
    editCaption: new GuardedEditCaption(editCaption, pieceRepo, reviewEditedCaption),
    retry: new RetryProduction(pieceRepo, jobs),
    markScheduled: new MarkScheduled(pieceRepo, clock),
    markPublished: new MarkPublished(pieceRepo, clock),
    get: new GetContentPiece(pieceRepo),
    list: new ListContentPieces(pieceRepo),
    editingStandards: editingStandardRepo,
    updateEditingStandard: new UpdateEditingStandard(editingStandardRepo, clock),
  };

  // ── governance ────────────────────────────────────────────────────────────
  const governance = {
    repo: reportRepo,
    runAutomatedReview: new RunAutomatedReview(
      reportRepo,
      contentForReview,
      adapters.contentReviewer,
      ids,
      clock,
      events,
      new ProductionGeneralReviewer(tools),
    ),
    reviewEditedCaption,
    latestReport: new GetLatestReviewReport(reportRepo),
  };

  // Publicação: real nos canais com a publicação ligada; simulada nos demais (e nos testes).
  const socialPublisher = deps.adapters
    ? adapters.socialPublisher
    : new InstagramSocialPublisher({
        integrations,
        simulated: adapters.socialPublisher,
        media,
        fetch: fetchFn,
      });

  // ── publishing ────────────────────────────────────────────────────────────
  const channelDirectory = new PublishingChannelDirectory(marketDirectory);
  const publishing = {
    repo: publicationRepo,
    schedule: new SchedulePublication(publicationRepo, channelDirectory, ids, clock, events),
    publishDue: new PublishDuePublications(
      publicationRepo,
      channelDirectory,
      new PublishingContentSource(pieceRepo),
      socialPublisher,
      clock,
      events,
    ),
    reschedule: new ReschedulePublication(publicationRepo, clock, events),
    cancel: new CancelPublication(publicationRepo, events),
    list: new ListPublications(publicationRepo),
  };

  // ── fiação entre contextos ────────────────────────────────────────────────
  subscribeStudioEventHandlers(events, {
    createAdaptations: studio.createAdaptations,
    recordAutomatedReview: studio.recordAutomatedReview,
    markScheduled: studio.markScheduled,
    markPublished: studio.markPublished,
  });
  events.subscribe(
    'studio.content_piece_produced',
    onContentPieceProduced(governance.runAutomatedReview),
  );
  events.subscribe('studio.content_piece_approved', onContentPieceApproved(publishing.schedule));
  events.subscribe<DomainEvent<'studio.content_piece_created', { referencePostId: string }>>(
    'studio.content_piece_created',
    async (e) => void (await reference.registerAdaptation.execute(e.payload.referencePostId)),
  );
  jobs.register<ProduceJobPayload>(StudioJobs.produce, async (payload) => {
    await studio.produce.execute(payload);
  });

  return {
    db,
    events,
    jobs,
    markets,
    reference,
    studio,
    governance,
    publishing,
    dashboard: new DashboardQuery(db, clock, marketRepo, pieceRepo, publicationRepo),
    demoData: new DemoDataCleanup(db),
    integrations,
    media,
    productionTools: tools,
  };
}

export type Container = ReturnType<typeof createContainer>;
