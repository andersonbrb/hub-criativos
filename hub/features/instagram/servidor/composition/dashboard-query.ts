import type { Activity, Dashboard } from '@sbs/contracts';
import type { MarketRepository } from '@sbs/markets';
import type { PublicationRepository } from '@sbs/publishing';
import type { Clock } from '@sbs/shared-kernel';
import type { ContentPieceRepository } from '@sbs/studio';
import { TZDate } from '@date-fns/tz';
import { toPublicationDto } from '../http/mappers/publishing-mapper';
import type { Database } from '../infrastructure/database/postgres-document-store';
import { recentEvents, type StoredEvent } from '../infrastructure/events/persistent-event-bus';

const IN_PRODUCTION = new Set(['queued', 'producing', 'ai_review']);
const DAY_MS = 86_400_000;

/**
 * Modelo de leitura do painel inicial. Cruza contextos só para leitura, por isso
 * mora no composition root e não em um contexto.
 */
export class DashboardQuery {
  constructor(
    private readonly db: () => Database,
    private readonly clock: Clock,
    private readonly markets: MarketRepository,
    private readonly pieces: ContentPieceRepository,
    private readonly publications: PublicationRepository,
  ) {}

  async execute(): Promise<Dashboard> {
    const now = this.clock.now();
    const [markets, pieces, publications, events] = await Promise.all([
      this.markets.list(),
      this.pieces.list(),
      this.publications.list(),
      recentEvents(this.db(), 15),
    ]);

    const isToday = (iso: string | null, tz: string) => {
      if (!iso) return false;
      const day = (d: Date) => new TZDate(d, tz).toDateString();
      return day(new Date(iso)) === day(now);
    };
    const tzOf = new Map(markets.map((m) => [m.id as string, m.timezone]));
    const pubs = publications.map((p) => p.toSnapshot());
    const tz = (marketId: string) => tzOf.get(marketId) ?? 'UTC';

    const scheduledToday = pubs.filter(
      (p) => p.status === 'scheduled' && isToday(p.scheduledAt, tz(p.marketId)),
    );
    const publishedToday = pubs.filter(
      (p) => p.status === 'published' && isToday(p.publishedAt, tz(p.marketId)),
    );
    const weekAgo = now.getTime() - 7 * DAY_MS;

    return {
      counts: {
        awaitingApproval: pieces.filter((p) => p.status === 'awaiting_approval').length,
        inProduction: pieces.filter((p) => IN_PRODUCTION.has(p.status)).length,
        changesRequested: pieces.filter((p) => p.status === 'changes_requested').length,
        scheduledToday: scheduledToday.length,
        publishedToday: publishedToday.length,
        failed:
          pieces.filter((p) => p.status === 'failed').length +
          pubs.filter((p) => p.status === 'failed').length,
      },
      nextPublications: publications
        .filter((p) => p.status === 'scheduled' && p.scheduledAt.getTime() >= now.getTime())
        .slice(0, 6)
        .map(toPublicationDto),
      perMarket: markets.map((m) => ({
        marketId: m.id,
        name: m.name,
        awaitingApproval: pieces.filter(
          (p) => p.marketId === m.id && p.status === 'awaiting_approval',
        ).length,
        scheduledToday: scheduledToday.filter((p) => p.marketId === m.id).length,
        publishedLast7Days: pubs.filter(
          (p) =>
            p.marketId === m.id &&
            p.status === 'published' &&
            p.publishedAt !== null &&
            Date.parse(p.publishedAt) >= weekAgo,
        ).length,
      })),
      recentActivity: events.map(describe).filter((a): a is Activity => a !== null),
    };
  }
}

/** Frases do feed de atividade, em português, para os eventos que interessam ao revisor. */
function describe(event: StoredEvent): Activity | null {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const pieceId = typeof p.contentPieceId === 'string' ? p.contentPieceId : null;
  const at = event.occurredAt.toISOString();
  const messages: Record<string, string> = {
    'reference.post_selected': 'Post de referência selecionado para adaptação',
    'studio.content_piece_created': 'Nova adaptação criada',
    'studio.content_piece_produced': 'Adaptação produzida e enviada para revisão automática',
    'governance.automated_review_completed': `Revisão automática concluída (nota ${String(p.score ?? '–')})`,
    'governance.caption_edit_reviewed': `Legenda editada revisada de novo (nota ${String(p.score ?? '–')})`,
    'studio.content_piece_approved': 'Adaptação aprovada',
    'studio.content_piece_rejected': 'Adaptação reprovada',
    'studio.content_piece_changes_requested': 'Ajustes pedidos pelo revisor',
    'studio.content_piece_failed': 'Falha na produção da adaptação',
    'publishing.publication_scheduled': 'Publicação agendada',
    'publishing.publication_rescheduled': 'Publicação reagendada',
    'publishing.publication_published': 'Publicado no Instagram',
    'publishing.publication_failed': 'Falha ao publicar no Instagram',
  };
  const message = messages[event.type];
  return message ? { at, message, contentPieceId: pieceId } : null;
}
