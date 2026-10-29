import type { ContentPieceStatus, ContentPieceSummary } from '@sbs/contracts';
import type { StatusTone } from '@/features/instagram/tela/lib/status';

export type PipelineColumnId =
  | 'in_production'
  | 'awaiting_approval'
  | 'changes_requested'
  | 'approved_scheduled'
  | 'published'
  | 'rejected_failed';

export interface PipelineColumnDef {
  id: PipelineColumnId;
  title: string;
  statuses: readonly ContentPieceStatus[];
  tone: StatusTone;
  emptyText: string;
}

/** Colunas do kanban, na ordem do fluxo. Todo status aparece em exatamente uma coluna. */
export const pipelineColumns: readonly PipelineColumnDef[] = [
  {
    id: 'in_production',
    title: 'Em produção',
    statuses: ['queued', 'producing', 'ai_review'],
    tone: 'progress',
    emptyText: 'Nada sendo produzido agora.',
  },
  {
    id: 'awaiting_approval',
    title: 'Aguardando aprovação',
    statuses: ['awaiting_approval'],
    tone: 'attention',
    emptyText: 'Fila de revisão zerada.',
  },
  {
    id: 'changes_requested',
    title: 'Voltaram para a edição',
    statuses: ['changes_requested'],
    tone: 'warning',
    emptyText: 'Nenhum ajuste em andamento.',
  },
  {
    id: 'approved_scheduled',
    title: 'Aprovados e agendados',
    statuses: ['approved', 'scheduled'],
    tone: 'scheduled',
    emptyText: 'Nada agendado.',
  },
  {
    id: 'published',
    title: 'Publicados',
    statuses: ['published'],
    tone: 'success',
    emptyText: 'Nada publicado ainda.',
  },
  {
    id: 'rejected_failed',
    title: 'Reprovados e falhas',
    statuses: ['rejected', 'failed'],
    tone: 'danger',
    emptyText: 'Nenhuma falha.',
  },
];

export interface PipelineColumn extends PipelineColumnDef {
  items: ContentPieceSummary[];
}

function compareWithin(columnId: PipelineColumnId) {
  return (a: ContentPieceSummary, b: ContentPieceSummary): number => {
    if (columnId === 'approved_scheduled') {
      // Próximas publicações primeiro; sem horário vai para o fim.
      if (a.scheduledAt && b.scheduledAt) return a.scheduledAt.localeCompare(b.scheduledAt);
      if (a.scheduledAt) return -1;
      if (b.scheduledAt) return 1;
    }
    if (columnId === 'awaiting_approval') {
      // Mais antigos primeiro: quem espera há mais tempo é revisado antes.
      return a.updatedAt.localeCompare(b.updatedAt);
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  };
}

/** Agrupa as peças nas colunas do kanban, opcionalmente filtrando por mercado. */
export function groupPieces(
  pieces: readonly ContentPieceSummary[],
  marketId?: string | null,
): PipelineColumn[] {
  const visible = marketId ? pieces.filter((piece) => piece.marketId === marketId) : pieces;
  return pipelineColumns.map((column) => ({
    ...column,
    items: visible
      .filter((piece) => column.statuses.includes(piece.status))
      .sort(compareWithin(column.id)),
  }));
}
