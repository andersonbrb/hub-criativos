import {
  InMemoryEventBus,
  type DomainEvent,
  type EventBus,
  type EventHandler,
} from '@sbs/shared-kernel';
import { desc, eq } from 'drizzle-orm';

import { instagramEventos } from '@/db/schema';
import { organizacaoAtual } from '@/features/acesso/servicos/organizacao-atual';

import type { Database } from '../database/postgres-document-store';

/**
 * Grava cada evento em `instagram_eventos`, na organização em que o código está rodando (auditoria e feed de
 * atividade da tela Início), e depois entrega aos assinantes em processo, que continuam na mesma organização.
 *
 * Próximo passo (roadmap): outbox transacional + worker, para entrega garantida
 * mesmo se o processo cair entre gravar o agregado e publicar o evento.
 */
export class PersistentEventBus implements EventBus {
  private readonly delegate = new InMemoryEventBus();

  constructor(private readonly db: () => Database) {}

  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): void {
    this.delegate.subscribe(type, handler);
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    const org = await organizacaoAtual();
    await this.db()
      .insert(instagramEventos)
      .values(
        events.map((e) => ({
          organizacaoId: org,
          tipo: e.type,
          ocorreuEm: new Date(e.occurredAt),
          dados: e.payload,
        })),
      );
    await this.delegate.publish(events);
  }
}

export interface StoredEvent {
  type: string;
  occurredAt: Date;
  payload: unknown;
}

export async function recentEvents(db: Database, limit: number): Promise<StoredEvent[]> {
  const org = await organizacaoAtual();
  return db
    .select({
      type: instagramEventos.tipo,
      occurredAt: instagramEventos.ocorreuEm,
      payload: instagramEventos.dados,
    })
    .from(instagramEventos)
    .where(eq(instagramEventos.organizacaoId, org))
    .orderBy(desc(instagramEventos.seq))
    .limit(limit);
}
