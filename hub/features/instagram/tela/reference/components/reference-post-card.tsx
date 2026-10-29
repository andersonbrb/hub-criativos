'use client';

import type { ReferencePost } from '@sbs/contracts';
import {
  Bookmark,
  Check,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  RotateCcw,
  Send,
  X,
  type LucideIcon,
} from 'lucide-react';
import { StatusBadge, Tag } from '@/features/instagram/tela/ui/badge';
import { Button } from '@/features/instagram/tela/ui/button';
import { MediaThumb } from '@/features/instagram/tela/ui/media';
import { Tooltip } from '@/features/instagram/tela/ui/tooltip';
import { excerpt, formatCompact, formatLongDate, formatScore } from '@/features/instagram/tela/lib/format';
import { formatLabel, referenceStatusMeta } from '@/features/instagram/tela/lib/status';
import { hasPrivateInsights, isAdaptable } from '../lib/reference-helpers';

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1" title={label}>
      <Icon className="size-3.5 text-ink-subtle" aria-hidden />
      <span className="sr-only">{label}:</span>
      <span className="tabular-nums">{formatCompact(value)}</span>
    </span>
  );
}

/**
 * Post ignorado ou já selecionado: pode ser selecionado (de novo) quando nenhuma adaptação
 * dele está em andamento — ou seja, as anteriores foram reprovadas ou publicadas.
 */
function ReselectAction({
  post,
  busy,
  onSelect,
}: {
  post: ReferencePost;
  busy: boolean;
  onSelect: () => void;
}) {
  const open = post.openAdaptationsCount;
  const label = post.status === 'selected' ? 'Selecionar novamente' : 'Selecionar';
  const button = (
    <Button size="sm" variant="primary" onClick={onSelect} disabled={open > 0 || busy}>
      {post.status === 'selected' ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
      {label}
    </Button>
  );
  if (open === 0) return <div className="grid">{button}</div>;
  return (
    <Tooltip
      content={
        open === 1
          ? '1 adaptação em andamento. Libera quando ela for reprovada ou publicada.'
          : `${open} adaptações em andamento. Libera quando elas forem reprovadas ou publicadas.`
      }
    >
      <span tabIndex={0} className="grid rounded-lg">
        {button}
      </span>
    </Tooltip>
  );
}

interface ReferencePostCardProps {
  post: ReferencePost;
  /** @ da página de onde veio o post. */
  sourceHandle?: string | null;
  rank: number | null;
  onSelect: () => void;
  onIgnore: () => void;
  busy: boolean;
}

export function ReferencePostCard({
  post,
  sourceHandle = null,
  rank,
  onSelect,
  onIgnore,
  busy,
}: ReferencePostCardProps) {
  const adaptable = isAdaptable(post);
  const insights = hasPrivateInsights(post);
  // Perfil público: só reels mostram visualizações.
  const showViews = insights || post.format === 'reel' || post.metrics.views > 0;
  const status = referenceStatusMeta[post.status];
  const selectButton = (
    <Button size="sm" variant="primary" onClick={onSelect} disabled={!adaptable || busy}>
      <Check aria-hidden />
      Selecionar
    </Button>
  );

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="relative">
        <MediaThumb
          src={post.thumbnailUrl}
          alt={`Post de ${formatLongDate(post.publishedAt)}`}
          format={post.format}
          className="rounded-none"
        />
        {rank !== null ? (
          <span className="absolute top-2 left-2 rounded-md bg-[#0b0f15]/65 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums backdrop-blur-sm">
            {rank}º
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge meta={status} />
          <Tag>{formatLabel(post.format)}</Tag>
          {post.adaptationsCount > 0 ? (
            <Tag title="Adaptações criadas a partir deste post">
              {post.adaptationsCount} {post.adaptationsCount === 1 ? 'adaptação' : 'adaptações'}
            </Tag>
          ) : null}
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <p
            className="text-xs text-ink-muted"
            title={
              insights
                ? 'Engajamento ponderado por mil pessoas alcançadas'
                : 'Engajamento: curtidas + 2 × comentários'
            }
          >
            Desempenho
          </p>
          <p className="font-display text-xl font-semibold tabular-nums text-ink">
            {formatScore(post.performanceScore)}
          </p>
        </div>

        <p className="line-clamp-3 text-[0.8125rem] leading-relaxed text-ink-muted">
          {excerpt(post.caption, 160) || 'Sem legenda'}
        </p>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink">
          {showViews ? (
            <Metric icon={Eye} label="Visualizações" value={post.metrics.views} />
          ) : null}
          <Metric icon={Heart} label="Curtidas" value={post.metrics.likes} />
          <Metric icon={MessageCircle} label="Comentários" value={post.metrics.comments} />
          {insights ? (
            <>
              <Metric icon={Bookmark} label="Salvamentos" value={post.metrics.saves} />
              <Metric icon={Send} label="Compartilhamentos" value={post.metrics.shares} />
            </>
          ) : null}
        </div>

        <div className="mt-auto space-y-3 border-t border-border pt-3">
          <a
            href={post.permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
          >
            {sourceHandle ? `@${sourceHandle} · ` : 'Publicado em '}
            {formatLongDate(post.publishedAt)}
            <ExternalLink className="size-3" aria-label="Abrir no Instagram" />
          </a>
          {post.status === 'new' ? (
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" onClick={onIgnore} disabled={busy}>
                <X aria-hidden />
                Ignorar
              </Button>
              {adaptable ? (
                selectButton
              ) : (
                <Tooltip content="Só reels e carrosséis podem ser adaptados.">
                  <span tabIndex={0} className="grid rounded-lg">
                    {selectButton}
                  </span>
                </Tooltip>
              )}
            </div>
          ) : adaptable ? (
            <ReselectAction post={post} busy={busy} onSelect={onSelect} />
          ) : null}
        </div>
      </div>
    </article>
  );
}
