import type { ContentPieceSummary, Market } from '@sbs/contracts';
import { CalendarClock, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge, Tag } from '@/features/instagram/tela/ui/badge';
import { MarketChip, MediaThumb } from '@/features/instagram/tela/ui/media';
import { cn } from '@/features/instagram/tela/lib/cn';
import { formatSchedule, formatScore } from '@/features/instagram/tela/lib/format';
import { contentStatus, formatLabel } from '@/features/instagram/tela/lib/status';

export function PipelineCard({
  piece,
  market,
  now,
}: {
  piece: ContentPieceSummary;
  market: Market | undefined;
  now: Date;
}) {
  const status = contentStatus(piece.status);
  const label = `${formatLabel(piece.format)} para ${market?.name ?? 'mercado'}, ${status.label}`;
  return (
    <Link
      href={`/instagram/conteudos/${piece.id}`}
      aria-label={label}
      className={cn(
        'group flex gap-3 rounded-xl border border-border bg-surface p-2.5 shadow-card transition-colors',
        'hover:border-border-strong focus-visible:border-ring',
        piece.hasBlockingIssues && piece.status === 'awaiting_approval' && 'border-danger/40',
      )}
    >
      <MediaThumb
        src={piece.thumbnailUrl}
        alt=""
        format={piece.format}
        className="w-16 shrink-0 self-start"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <MarketChip market={market} fallbackId={piece.marketId} size="sm" />
        <p className="line-clamp-2 text-[0.8125rem] leading-snug text-ink-muted">
          {piece.captionPreview || 'Sem legenda'}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1">
          <Tag>{formatLabel(piece.format)}</Tag>
          <Tag>Rev. {piece.revisionNumber}</Tag>
          {piece.aiScore !== null ? (
            <Tag title="Nota da revisão automática">IA {formatScore(piece.aiScore)}</Tag>
          ) : null}
          {piece.hasBlockingIssues ? (
            <Tag className="border-danger/40 bg-danger-soft text-danger-ink">
              <ShieldAlert aria-hidden />
              Bloqueio
            </Tag>
          ) : null}
        </div>
        {piece.scheduledAt ? (
          <p className="flex items-center gap-1 text-xs text-scheduled-ink">
            <CalendarClock className="size-3.5" aria-hidden />
            {formatSchedule(piece.scheduledAt, now, market?.timezone)}
            {market ? <span className="text-ink-subtle">(hora local)</span> : null}
          </p>
        ) : null}
        {['queued', 'producing', 'ai_review', 'failed', 'rejected', 'approved'].includes(
          piece.status,
        ) ? (
          <StatusBadge meta={status} className="self-start" />
        ) : null}
      </div>
    </Link>
  );
}
