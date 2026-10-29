import { DomainError } from '@sbs/shared-kernel';

export const MarketErrors = {
  invalidCode: (code: string) =>
    new DomainError(
      'invalid_market_code',
      'O código do mercado deve ter de 2 a 20 letras minúsculas, números ou hífens.',
      { code },
    ),
  invalidName: () => new DomainError('invalid_market_name', 'O nome do mercado é obrigatório.'),
  invalidTimezone: (timezone: string) =>
    new DomainError('invalid_timezone', `Fuso horário desconhecido: "${timezone}".`, { timezone }),
  invalidProductName: () =>
    new DomainError('invalid_product_name', 'O nome do produto é obrigatório.'),
  invalidOfferUrl: (url: string) =>
    new DomainError('invalid_offer_url', 'O link da oferta deve ser uma URL http(s).', { url }),
  duplicateGlossaryTerm: (term: string) =>
    new DomainError(
      'duplicate_glossary_term',
      `O termo "${term}" aparece duas vezes no glossário.`,
      {
        term,
      },
    ),
  emptyGlossaryTerm: () =>
    new DomainError('invalid_glossary_term', 'Termos do glossário não podem ser vazios.'),
  invalidHandle: (handle: string) =>
    new DomainError(
      'invalid_handle',
      'Usuário do Instagram inválido: use até 30 letras, números, ponto ou sublinhado.',
      { handle },
    ),
  invalidDisplayName: () =>
    new DomainError('invalid_display_name', 'O nome de exibição do canal é obrigatório.'),
  invalidPostingPlan: (reason: string) =>
    new DomainError('invalid_posting_plan', `Grade de postagem inválida: ${reason}`),
  marketCodeTaken: (code: string) =>
    new DomainError('market_code_taken', `Já existe um mercado com o código "${code}".`, { code }),
  handleTaken: (handle: string) =>
    new DomainError('handle_taken', `A conta @${handle} já está cadastrada.`, { handle }),
};
