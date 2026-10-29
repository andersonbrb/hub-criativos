import type { DomainEvent } from './domain-event';
import type { Clock, EventBus, EventHandler, IdGenerator } from './ports';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    return crypto.randomUUID();
  }
}

/**
 * Barramento síncrono em processo: entrega cada evento a todos os assinantes, em ordem.
 * Erros de um assinante são propagados para quem publicou.
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();

  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(type, list);
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const handler of this.handlers.get(event.type) ?? []) {
        await handler(event);
      }
    }
  }
}
