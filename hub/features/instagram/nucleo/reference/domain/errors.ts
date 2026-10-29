import { DomainError } from '@sbs/shared-kernel';

export const ReferenceErrors = {
  invalidHandle: (handle: string) =>
    new DomainError(
      'invalid_handle',
      'Usuário do Instagram inválido: use até 30 letras, números, ponto ou sublinhado.',
      { handle },
    ),
  sourceHandleTaken: (handle: string) =>
    new DomainError('source_handle_taken', `A conta de referência @${handle} já está cadastrada.`, {
      handle,
    }),
  invalidExternalId: () =>
    new DomainError(
      'invalid_external_id',
      'O post de referência precisa do identificador do Instagram.',
    ),
  invalidMetrics: (metric: string, value: unknown) =>
    new DomainError(
      'invalid_post_metrics',
      `A métrica "${metric}" deve ser um número inteiro maior ou igual a zero.`,
      { metric, value },
    ),
  formatNotAdaptable: (format: string) =>
    new DomainError(
      'format_not_adaptable',
      `Ainda não adaptamos posts no formato "${format}": só reels e carrosséis.`,
      { format },
    ),
  postAlreadySelected: () =>
    new DomainError(
      'post_already_selected',
      'Este post já foi selecionado para adaptação e não pode ser ignorado.',
    ),
  adaptationsInProgress: (count: number) =>
    new DomainError(
      'adaptations_in_progress',
      count === 1
        ? 'Este post já tem 1 adaptação em andamento. Selecione de novo depois que ela for reprovada ou publicada.'
        : `Este post já tem ${count} adaptações em andamento. Selecione de novo depois que elas forem reprovadas ou publicadas.`,
      { count },
    ),
  invalidSelectionPolicy: (reason: string) =>
    new DomainError('invalid_selection_policy', `Política de seleção inválida: ${reason}`),
  sourceDisconnected: (handle: string) =>
    new DomainError(
      'reference_source_disconnected',
      `A página @${handle} está desconectada: conecte-a para puxar os posts.`,
      { handle },
    ),
  feedNotConfigured: () =>
    new DomainError(
      'reference_feed_not_configured',
      'A leitura da conta de referência não está configurada: defina APIFY_TOKEN no servidor.',
    ),
  feedUnavailable: (handle: string, reason: string) =>
    new DomainError(
      'reference_feed_unavailable',
      `Não foi possível ler os posts de @${handle} no Instagram: ${reason}`,
      { handle },
    ),
};
