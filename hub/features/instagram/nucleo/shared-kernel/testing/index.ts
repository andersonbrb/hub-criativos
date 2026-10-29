import type { DomainEvent } from '../domain-event';
import type { Clock, EventBus, EventHandler, IdGenerator, JobQueue } from '../ports';

/** Relógio controlável para testes. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(iso = '2026-10-15T12:00:00.000Z') {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

/** Gera `prefix-1`, `prefix-2`… para asserções legíveis. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = 'id') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}

/** Barramento que só registra o que foi publicado. */
export class RecordingEventBus implements EventBus {
  readonly published: DomainEvent[] = [];

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
  }

  subscribe<E extends DomainEvent>(_type: E['type'], _handler: EventHandler<E>): void {
    // Não entrega: os testes inspecionam `published`.
  }

  typesPublished(): string[] {
    return this.published.map((e) => e.type);
  }
}

export class RecordingJobQueue implements JobQueue {
  readonly jobs: { job: string; payload: unknown; runAt?: Date }[] = [];

  async enqueue<TPayload>(job: string, payload: TPayload, options?: { runAt?: Date }) {
    this.jobs.push({ job, payload, ...(options?.runAt ? { runAt: options.runAt } : {}) });
  }
}
