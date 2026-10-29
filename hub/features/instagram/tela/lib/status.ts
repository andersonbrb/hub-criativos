import type {
  ContentFormat,
  ContentPieceStatus,
  IntegrationStatus,
  ProductionStep,
  PublicationStatus,
  ReferencePostStatus,
  ReferenceSource,
} from '@sbs/contracts';

/**
 * Sistema de cores de status. Cada tom tem três tokens em `globals.css`:
 * `--<tom>` (sólido), `--<tom>-soft` (fundo) e `--<tom>-ink` (texto sobre o fundo).
 * Toda a UI pega rótulo e cor de status daqui.
 */
export type StatusTone =
  'neutral' | 'progress' | 'attention' | 'warning' | 'info' | 'scheduled' | 'success' | 'danger';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** Frase curta que explica o status para o revisor. */
  description: string;
}

export interface ToneClasses {
  badge: string;
  dot: string;
  border: string;
  text: string;
}

export const toneClasses: Record<StatusTone, ToneClasses> = {
  neutral: {
    badge: 'bg-neutral-soft text-neutral-ink',
    dot: 'bg-neutral',
    border: 'border-neutral',
    text: 'text-neutral',
  },
  progress: {
    badge: 'bg-progress-soft text-progress-ink',
    dot: 'bg-progress',
    border: 'border-progress',
    text: 'text-progress',
  },
  attention: {
    badge: 'bg-attention-soft text-attention-ink',
    dot: 'bg-attention',
    border: 'border-attention',
    text: 'text-attention',
  },
  warning: {
    badge: 'bg-warning-soft text-warning-ink',
    dot: 'bg-warning',
    border: 'border-warning',
    text: 'text-warning',
  },
  info: {
    badge: 'bg-info-soft text-info-ink',
    dot: 'bg-info',
    border: 'border-info',
    text: 'text-info',
  },
  scheduled: {
    badge: 'bg-scheduled-soft text-scheduled-ink',
    dot: 'bg-scheduled',
    border: 'border-scheduled',
    text: 'text-scheduled',
  },
  success: {
    badge: 'bg-success-soft text-success-ink',
    dot: 'bg-success',
    border: 'border-success',
    text: 'text-success',
  },
  danger: {
    badge: 'bg-danger-soft text-danger-ink',
    dot: 'bg-danger',
    border: 'border-danger',
    text: 'text-danger',
  },
};

export const contentStatusMeta: Record<ContentPieceStatus, StatusMeta> = {
  queued: {
    label: 'Na fila',
    tone: 'neutral',
    description: 'Aguardando a produção começar.',
  },
  producing: {
    label: 'Produzindo',
    tone: 'progress',
    description: 'Legenda e mídia estão sendo adaptadas para o mercado.',
  },
  ai_review: {
    label: 'Revisão automática',
    tone: 'progress',
    description: 'As checagens automáticas estão rodando.',
  },
  awaiting_approval: {
    label: 'Aguardando aprovação',
    tone: 'attention',
    description: 'Pronto para você aprovar, reprovar ou voltar para a edição.',
  },
  changes_requested: {
    label: 'Voltou para a edição',
    tone: 'warning',
    description: 'Uma nova versão está sendo editada com o motivo do revisor.',
  },
  approved: {
    label: 'Aprovado',
    tone: 'info',
    description: 'Aprovado. O horário de publicação está sendo reservado.',
  },
  scheduled: {
    label: 'Agendado',
    tone: 'scheduled',
    description: 'Publicação agendada no canal do mercado.',
  },
  published: {
    label: 'Publicado',
    tone: 'success',
    description: 'Publicado no Instagram do mercado.',
  },
  rejected: {
    label: 'Reprovado',
    tone: 'neutral',
    description: 'Reprovado. Esta adaptação não será publicada.',
  },
  failed: {
    label: 'Falhou',
    tone: 'danger',
    description: 'A produção falhou. Veja o motivo e tente novamente.',
  },
};

export const publicationStatusMeta: Record<PublicationStatus, StatusMeta> = {
  scheduled: {
    label: 'Agendada',
    tone: 'scheduled',
    description: 'Vai ao ar no horário marcado.',
  },
  publishing: { label: 'Publicando', tone: 'progress', description: 'Enviando ao Instagram.' },
  published: { label: 'Publicada', tone: 'success', description: 'Está no ar.' },
  failed: {
    label: 'Falhou',
    tone: 'danger',
    description: 'Todas as tentativas falharam. Reagende para tentar de novo.',
  },
  cancelled: { label: 'Cancelada', tone: 'neutral', description: 'Não será publicada.' },
};

export const referenceStatusMeta: Record<ReferencePostStatus, StatusMeta> = {
  new: { label: 'Novo', tone: 'info', description: 'Ainda não foi avaliado.' },
  selected: {
    label: 'Selecionado',
    tone: 'success',
    description: 'Escolhido para adaptação nos mercados ativos.',
  },
  ignored: { label: 'Ignorado', tone: 'neutral', description: 'Não será adaptado.' },
};

export const referenceSourceStatusMeta: Record<ReferenceSource['connectionStatus'], StatusMeta> = {
  connected: {
    label: 'Conectada',
    tone: 'success',
    description: 'Os posts desta página são puxados na sincronização.',
  },
  disconnected: {
    label: 'Desconectada',
    tone: 'neutral',
    description: 'Os posts desta página não são mais puxados.',
  },
};

export const productionStepStatusMeta: Record<ProductionStep['status'], StatusMeta> = {
  running: {
    label: 'Em andamento',
    tone: 'progress',
    description: 'O agente está trabalhando nesta etapa.',
  },
  approved: { label: 'Aprovada', tone: 'success', description: 'O revisor aprovou o resultado.' },
  rejected: {
    label: 'Reprovada',
    tone: 'danger',
    description: 'Reprovada 3 vezes: precisa de decisão humana.',
  },
  skipped: {
    label: 'Pulada',
    tone: 'neutral',
    description: 'Etapa não se aplica ou falta integração.',
  },
  failed: { label: 'Com erro', tone: 'danger', description: 'A ferramenta falhou.' },
};

export const integrationStatusMeta: Record<IntegrationStatus['status'], StatusMeta> = {
  connected: { label: 'Conectado', tone: 'success', description: 'Em uso.' },
  disconnected: { label: 'Não conectado', tone: 'neutral', description: 'Ainda não ligado.' },
  error: { label: 'Com erro', tone: 'danger', description: 'A verificação falhou.' },
};

export function contentStatus(status: ContentPieceStatus): StatusMeta {
  return contentStatusMeta[status];
}

function isPublicationStatus(status: string): status is PublicationStatus {
  return Object.hasOwn(publicationStatusMeta, status);
}

/** `ContentPiece.publication.status` chega como string livre no contrato; tolera valores novos. */
export function publicationStatus(status: string): StatusMeta {
  if (isPublicationStatus(status)) return publicationStatusMeta[status];
  return { label: status, tone: 'neutral', description: '' };
}

/** Status em que o revisor pode decidir e editar a legenda. */
export function isAwaitingDecision(status: ContentPieceStatus): boolean {
  return status === 'awaiting_approval';
}

/** Status em que a peça ainda está sendo trabalhada pelo sistema. */
export function isInProduction(status: ContentPieceStatus): boolean {
  return status === 'queued' || status === 'producing' || status === 'ai_review';
}

export const formatLabels: Record<ContentFormat, string> = {
  reel: 'Reel',
  carousel: 'Carrossel',
  image: 'Imagem',
  story: 'Story',
};

export function formatLabel(format: ContentFormat): string {
  return formatLabels[format];
}
