/**
 * Erro de regra de negócio. O `code` é estável e é o que a API devolve ao painel;
 * a mensagem é para pessoas.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('not_found', `Não encontrado: ${entity} ${id}.`, { entity, id });
    this.name = 'NotFoundError';
  }
}

export class ConcurrencyError extends DomainError {
  constructor(entity: string, id: string) {
    super('concurrency_conflict', `${entity} ${id} foi alterado por outra operação.`, {
      entity,
      id,
    });
    this.name = 'ConcurrencyError';
  }
}

export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
