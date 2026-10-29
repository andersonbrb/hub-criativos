import type { DemoDataSummary } from '@sbs/contracts';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { instagramDocumentos as aggregates, instagramEventos as domainEvents } from '@/db/schema';
import { organizacaoAtual } from '@/features/acesso/servicos/organizacao-atual';

import type { Database } from '../infrastructure/database/postgres-document-store';

/**
 * Dados de demonstração: os posts do feed falso (imagens de exemplo do picsum.photos) e tudo
 * que derivou deles — adaptações, relatórios de revisão, publicações e os eventos no histórico.
 * Posts reais, mercados, canais e a conta de referência nunca entram.
 *
 * Fica no composition root porque atravessa contextos (reference → studio → governance e
 * publishing); é manutenção, não regra de negócio. Só enxerga a organização em que o código está rodando.
 */
const DEMO_MEDIA_PREFIX = 'https://picsum.photos/%';

interface DemoData {
  posts: string[];
  pieces: string[];
  reviews: string[];
  publications: string[];
  events: number[];
}

export class DemoDataCleanup {
  constructor(private readonly db: () => Database) {}

  async summary(): Promise<DemoDataSummary> {
    return toSummary(await find(this.db(), await organizacaoAtual()));
  }

  /** Apaga tudo numa transação e devolve o que foi removido. */
  async purge(): Promise<DemoDataSummary> {
    const org = await organizacaoAtual();
    return this.db().transaction(async (tx) => {
      const found = await find(tx as unknown as Database, org);
      const ids = [...found.posts, ...found.pieces, ...found.reviews, ...found.publications];
      if (ids.length > 0) await tx.delete(aggregates).where(and(eq(aggregates.organizacaoId, org), inArray(aggregates.id, ids)));
      if (found.events.length > 0)
        await tx.delete(domainEvents).where(and(eq(domainEvents.organizacaoId, org), inArray(domainEvents.seq, found.events)));
      return toSummary(found);
    });
  }
}

async function find(db: Database, org: string): Promise<DemoData> {
  const idsOf = async (type: string, field: string, values: string[]) => {
    if (values.length === 0) return [];
    const rows = await db
      .select({ id: aggregates.id })
      .from(aggregates)
      .where(
        and(eq(aggregates.organizacaoId, org), eq(aggregates.tipo, type), inArray(sql<string>`${aggregates.dados}->>${field}`, values)),
      );
    return rows.map((r) => r.id);
  };

  const posts = (
    await db
      .select({ id: aggregates.id })
      .from(aggregates)
      .where(
        and(
          eq(aggregates.organizacaoId, org),
          eq(aggregates.tipo, 'reference.post'),
          like(sql<string>`${aggregates.dados}->>'thumbnailUrl'`, DEMO_MEDIA_PREFIX),
        ),
      )
  ).map((r) => r.id);
  const pieces = await idsOf('studio.content_piece', 'referencePostId', posts);
  const reviews = await idsOf('governance.review_report', 'contentPieceId', pieces);
  const publications = await idsOf('publishing.publication', 'contentPieceId', pieces);

  const all = [...posts, ...pieces, ...reviews, ...publications];
  const events =
    all.length === 0
      ? []
      : (
          await db
            .select({ seq: domainEvents.seq })
            .from(domainEvents)
            .where(
              and(
                eq(domainEvents.organizacaoId, org),
                or(...all.map((id) => like(sql<string>`${domainEvents.dados}::text`, `%${id}%`))),
              ),
            )
        ).map((r) => r.seq);

  return { posts, pieces, reviews, publications, events };
}

function toSummary(found: DemoData): DemoDataSummary {
  return {
    posts: found.posts.length,
    adaptations: found.pieces.length,
    reviews: found.reviews.length,
    publications: found.publications.length,
    events: found.events.length,
  };
}
