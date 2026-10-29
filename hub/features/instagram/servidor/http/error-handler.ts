import { ConcurrencyError, DomainError, NotFoundError } from '@sbs/shared-kernel';
import type { ApiError } from '@sbs/contracts';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** Traduz erros de domínio e de validação para o formato `ApiError` dos contratos. */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const body: ApiError = {
      code: 'validation_error',
      message: 'Dados inválidos.',
      details: { issues: error.validation },
    };
    return reply.status(400).send(body);
  }

  if (error instanceof NotFoundError) return reply.status(404).send(toApiError(error));
  if (error instanceof ConcurrencyError) return reply.status(409).send(toApiError(error));
  if (error instanceof DomainError && error.code === 'forbidden')
    return reply.status(403).send(toApiError(error));
  if (error instanceof DomainError) return reply.status(422).send(toApiError(error));
  // Pedido malformado que o próprio Fastify recusa (corpo vazio, JSON inválido, grande demais).
  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    const body: ApiError = { code: 'bad_request', message: 'Pedido inválido.' };
    return reply.status(error.statusCode).send(body);
  }

  // O Fastify do hub não tem registro próprio: o erro vai para o registro do servidor do hub.
  console.error(`[instagram] erro inesperado em ${request.method} ${request.url}:`, error);
  const body: ApiError = { code: 'internal_error', message: 'Erro interno. Tente novamente.' };
  return reply.status(500).send(body);
}

function toApiError(error: DomainError): ApiError {
  return { code: error.code, message: error.message, details: { ...error.details } };
}
