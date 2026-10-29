import {
  NotFoundError,
  ReferencePostId,
  ReferenceSourceId,
  type Clock,
  type IdGenerator,
} from '@sbs/shared-kernel';
import {
  ReferenceErrors,
  ReferencePost,
  type ReferencePostRepository,
  type ReferenceSourceRepository,
} from '../../domain';
import type { ReferenceFeed } from '../ports/reference-feed';

export interface SyncReferenceFeedInput {
  sourceId: string;
}

export interface SyncReferenceFeedResult {
  /** Posts que ainda não existiam. */
  imported: number;
  /** Posts existentes cujas métricas mudaram. */
  updated: number;
}

/**
 * Traz os posts recentes da conta de referência: cria os novos e atualiza as métricas dos
 * existentes (identificados por fonte + id externo). Rodar de novo sem mudanças não altera nada.
 */
export class SyncReferenceFeed {
  constructor(
    private readonly sources: ReferenceSourceRepository,
    private readonly posts: ReferencePostRepository,
    private readonly feed: ReferenceFeed,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: SyncReferenceFeedInput): Promise<SyncReferenceFeedResult> {
    const source = await this.sources.findById(ReferenceSourceId(input.sourceId));
    if (!source) throw new NotFoundError('Conta de referência', input.sourceId);
    if (!source.isConnected) throw ReferenceErrors.sourceDisconnected(source.handle);

    const now = this.clock.now();
    const items = await this.feed.fetchRecent({ id: source.id, handle: source.handle }, now);

    let imported = 0;
    let updated = 0;
    for (const item of items) {
      const existing = await this.posts.findBySourceAndExternalId(source.id, item.externalId);
      if (!existing) {
        await this.posts.save(
          ReferencePost.create(ReferencePostId(this.ids.next()), { ...item, sourceId: source.id }),
        );
        imported += 1;
        continue;
      }
      // Sem mudança não grava: evita subir a versão e disputar concorrência à toa.
      if (!existing.refreshFromFeed(item)) continue;
      await this.posts.save(existing);
      updated += 1;
    }

    source.markSynced(now);
    await this.sources.save(source);
    return { imported, updated };
  }
}
