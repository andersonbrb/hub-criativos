/**
 * Fato de negócio que já aconteceu. Nome no passado, payload serializável.
 * Os eventos são o único meio de um bounded context reagir a outro.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly type: TType;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export function domainEvent<TType extends string, TPayload>(
  type: TType,
  occurredAt: Date,
  payload: TPayload,
): DomainEvent<TType, TPayload> {
  return { type, occurredAt: occurredAt.toISOString(), payload };
}
