import {
  ChannelId,
  ContentPieceId,
  MarketId,
  PublicationId,
  ReferencePostId,
  UserId,
  type AdaptableFormat,
  type ReferencePostSelected,
} from '@sbs/shared-kernel';
import type { MarketProfile } from '../application';
import {
  ContentPiece,
  type ContentAssets,
  type ContentPieceStatus,
  type NewContentPiece,
} from '../domain';

export const T0 = new Date('2026-10-15T12:00:00.000Z');
export const REVIEWER = UserId('reviewer-1');

export function aNewContentPiece(overrides: Partial<NewContentPiece> = {}): NewContentPiece {
  return {
    referencePostId: ReferencePostId('post-1'),
    marketId: MarketId('market-es'),
    channelId: ChannelId('channel-es'),
    format: 'reel',
    source: {
      caption: 'Oração de São Bento para proteger sua casa 🙏 #fe #oracao',
      permalink: 'https://www.instagram.com/p/ABC123/',
      thumbnailUrl: 'https://cdn.example.com/ref/abc123-thumb.jpg',
      mediaUrls: ['https://cdn.example.com/ref/abc123.mp4'],
    },
    ...overrides,
  };
}

export function someAssets(format: AdaptableFormat = 'reel'): ContentAssets {
  return format === 'reel'
    ? { format: 'reel', videoUrl: 'https://cdn.example.com/es/abc123.mp4', coverUrl: null }
    : {
        format: 'carousel',
        slideUrls: ['https://cdn.example.com/es/1.jpg', 'https://cdn.example.com/es/2.jpg'],
      };
}

/** Caminho mínimo de transições, a partir de `queued`, até cada status. */
const PATHS: Record<ContentPieceStatus, ((p: ContentPiece) => void)[]> = {
  queued: [],
  producing: [start],
  ai_review: [start, complete],
  awaiting_approval: [start, complete, review],
  changes_requested: [start, complete, review, requestChanges],
  approved: [start, complete, review, approve],
  scheduled: [start, complete, review, approve, schedule],
  published: [start, complete, review, approve, schedule, publish],
  rejected: [start, complete, review, reject],
  failed: [start, fail],
};

/** Uma peça já no status pedido, sem eventos pendentes. */
export function aContentPiece(
  options: { status?: ContentPieceStatus; id?: string } & Partial<NewContentPiece> = {},
): ContentPiece {
  const { status = 'queued', id = 'piece-1', ...overrides } = options;
  const piece = ContentPiece.create(ContentPieceId(id), aNewContentPiece(overrides), T0);
  for (const step of PATHS[status]) step(piece);
  piece.pullEvents();
  return piece;
}

function start(p: ContentPiece) {
  p.startProduction(T0);
}
function complete(p: ContentPiece) {
  p.completeProduction(
    { caption: 'Oración de San Benito 🙏', hashtags: ['#sanbenito'], assets: someAssets(p.format) },
    T0,
  );
}
function review(p: ContentPiece) {
  p.recordAutomatedReview({ reportId: 'report-1', score: 90, hasBlockingIssues: false }, T0);
}
function requestChanges(p: ContentPiece) {
  p.requestChanges(REVIEWER, 'Deixe o gancho mais curto.', T0);
}
function approve(p: ContentPiece) {
  p.approve(REVIEWER, T0);
}
function schedule(p: ContentPiece) {
  p.markScheduled(
    { publicationId: PublicationId('pub-1'), scheduledAt: new Date('2026-10-16T16:00:00.000Z') },
    T0,
  );
}
function publish(p: ContentPiece) {
  p.markPublished(
    {
      permalink: 'https://www.instagram.com/p/ES123/',
      publishedAt: new Date('2026-10-16T16:00:05.000Z'),
    },
    T0,
  );
}
function reject(p: ContentPiece) {
  p.reject(REVIEWER, 'Fora do tom da marca.', T0);
}
function fail(p: ContentPiece) {
  p.failProduction('A plataforma de criativos não respondeu.', T0);
}

export function aMarketProfile(overrides: Partial<MarketProfile> = {}): MarketProfile {
  return {
    marketId: 'market-es',
    name: 'Espanhol (América Latina)',
    locale: 'es-419',
    timezone: 'America/Mexico_City',
    productName: 'San Benito',
    offerUrl: 'https://sanbenito.example.com/oferta',
    glossary: [
      { source: 'São Bento', target: 'San Benito' },
      { source: 'Oração', target: 'Oración' },
    ],
    forbiddenTerms: ['Sagrado Verso'],
    status: 'active',
    ...overrides,
  };
}

export function aReferencePostSelectedPayload(
  overrides: Partial<ReferencePostSelected['payload']> = {},
): ReferencePostSelected['payload'] {
  return {
    referencePostId: 'post-1',
    format: 'reel',
    caption: 'Oração de São Bento para proteger sua casa 🙏 #fe #oracao',
    permalink: 'https://www.instagram.com/p/ABC123/',
    thumbnailUrl: 'https://cdn.example.com/ref/abc123-thumb.jpg',
    mediaUrls: ['https://cdn.example.com/ref/abc123.mp4'],
    ...overrides,
  };
}
