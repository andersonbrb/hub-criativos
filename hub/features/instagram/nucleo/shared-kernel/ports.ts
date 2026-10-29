import type { DomainEvent } from './domain-event';

/** Fonte de tempo. Injetada para que regras com datas sejam testáveis. */
export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void>;

/** Barramento de eventos entre contextos. Implementações: em memória (dev/testes) e outbox (produção). */
export interface EventBus {
  publish(events: readonly DomainEvent[]): Promise<void>;
  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): void;
}

/** Fila de trabalhos assíncronos (produção de mídia, publicação agendada…). */
export interface JobQueue {
  enqueue<TPayload>(job: string, payload: TPayload, options?: { runAt?: Date }): Promise<void>;
}
