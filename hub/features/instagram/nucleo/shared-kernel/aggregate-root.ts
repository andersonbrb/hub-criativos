import type { DomainEvent } from './domain-event';

/**
 * Raiz de agregado. Guarda os eventos gerados pelas mudanças de estado até que
 * a camada de aplicação os publique depois de salvar.
 *
 * `version` é usado pelo repositório para concorrência otimista.
 */
export abstract class AggregateRoot<TId extends string> {
  private pendingEvents: DomainEvent[] = [];

  protected constructor(
    readonly id: TId,
    private _version: number,
  ) {}

  get version(): number {
    return this._version;
  }

  protected record(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  /** Devolve e limpa os eventos pendentes. Chamado pelo repositório/aplicação após persistir. */
  pullEvents(): DomainEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  /** Chamado pelo repositório depois de gravar com sucesso. */
  markPersisted(version: number): void {
    this._version = version;
  }
}
