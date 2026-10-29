'use client';

import type { Dashboard, ContentPieceSummary, Publication } from '@sbs/contracts';
import { Activity, CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge, Tag } from '@/features/instagram/tela/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { MarketChip, MediaThumb } from '@/features/instagram/tela/ui/media';
import { useMarketIndex } from '@/features/instagram/tela/markets/hooks/use-markets';
import { useContentPieces } from '@/features/instagram/tela/pipeline/hooks/use-content-pieces';
import { cn } from '@/features/instagram/tela/lib/cn';
import { formatNumber, formatRelative, formatSchedule, timeZoneCity } from '@/features/instagram/tela/lib/format';
import type { MarketIndex } from '@/features/instagram/tela/lib/market-display';
import { formatLabel, publicationStatusMeta, toneClasses, type StatusTone } from '@/features/instagram/tela/lib/status';
import { useNow } from '@/features/instagram/tela/lib/use-now';
import { useDashboard } from '../hooks/use-dashboard';
import { ReviewQueueHero } from './review-queue-hero';

interface Counter {
  key: keyof Dashboard['counts'];
  label: string;
  tone: StatusTone;
  href: string;
}

const counters: readonly Counter[] = [
  { key: 'awaitingApproval', label: 'Aguardando aprovação', tone: 'attention', href: '/instagram/producao' },
  { key: 'inProduction', label: 'Em produção', tone: 'progress', href: '/instagram/producao' },
  { key: 'changesRequested', label: 'Voltaram para a edição', tone: 'warning', href: '/instagram/producao' },
  { key: 'scheduledToday', label: 'Agendados hoje', tone: 'scheduled', href: '/instagram/calendario' },
  { key: 'publishedToday', label: 'Publicados hoje', tone: 'success', href: '/instagram/calendario' },
  { key: 'failed', label: 'Falhas', tone: 'danger', href: '/instagram/producao' },
];

function CounterStrip({ counts }: { counts: Dashboard['counts'] }) {
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-card sm:grid-cols-3 xl:grid-cols-6">
      {counters.map((counter) => {
        const value = counts[counter.key];
        const alarming = counter.key === 'failed' && value > 0;
        return (
          <li key={counter.key} className="bg-surface">
            <Link
              href={counter.href}
              className={cn(
                'flex h-full flex-col gap-1 px-4 py-3.5 transition-colors hover:bg-surface-sunken',
                alarming && 'bg-danger-soft/50',
              )}
            >
              <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span
                  aria-hidden
                  className={cn('size-1.5 rounded-full', toneClasses[counter.tone].dot)}
                />
                {counter.label}
              </span>
              <span
                className={cn(
                  'text-2xl font-semibold tabular-nums text-ink',
                  alarming && 'text-danger',
                )}
              >
                {formatNumber(value)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NextPublications({
  publications,
  pieces,
  markets,
  now,
}: {
  publications: readonly Publication[];
  pieces: ReadonlyMap<string, ContentPieceSummary>;
  markets: MarketIndex;
  now: Date;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Próximas publicações</CardTitle>
        <Link href="/instagram/calendario" className="text-xs font-medium text-primary hover:underline">
          Abrir calendário
        </Link>
      </CardHeader>
      <CardContent>
        {publications.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title="Nada agendado"
            description="Peças aprovadas entram aqui no próximo horário livre da grade do canal."
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-border">
            {publications.map((publication) => {
              const market = markets.get(publication.marketId);
              const piece = pieces.get(publication.contentPieceId);
              return (
                <li key={publication.id}>
                  <Link
                    href={`/instagram/conteudos/${publication.contentPieceId}`}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-sunken"
                  >
                    <MediaThumb
                      src={piece?.thumbnailUrl}
                      alt=""
                      format={publication.format}
                      className="w-10 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <MarketChip market={market} fallbackId={publication.marketId} size="sm" />
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {piece?.captionPreview ?? formatLabel(publication.format)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-ink tabular-nums">
                        {formatSchedule(publication.scheduledAt, now, market?.timezone)}
                      </p>
                      <p className="text-xs text-ink-subtle">
                        {market ? `hora de ${timeZoneCity(market.timezone)}` : null}
                      </p>
                    </div>
                    <StatusBadge
                      meta={publicationStatusMeta[publication.status]}
                      className="hidden sm:inline-flex"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity({ activity, now }: { activity: Dashboard['recentActivity']; now: Date }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Atividade recente</CardTitle>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <EmptyState
            icon={<Activity />}
            title="Sem atividade ainda"
            description="Decisões, publicações e sincronizações aparecem aqui."
            className="py-8"
          />
        ) : (
          <ol className="space-y-3">
            {activity.slice(0, 8).map((item, index) => {
              const body = (
                <>
                  <p className="text-sm leading-snug text-ink">{item.message}</p>
                  <time dateTime={item.at} className="text-xs text-ink-subtle">
                    {formatRelative(item.at, now)}
                  </time>
                </>
              );
              return (
                <li key={`${item.at}-${index}`} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-border-strong"
                  />
                  {item.contentPieceId ? (
                    <Link
                      href={`/instagram/conteudos/${item.contentPieceId}`}
                      className="-mx-1 min-w-0 rounded px-1 hover:bg-surface-sunken"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="min-w-0">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function MarketCards({
  perMarket,
  markets,
}: {
  perMarket: Dashboard['perMarket'];
  markets: MarketIndex;
}) {
  if (perMarket.length === 0) {
    return (
      <EmptyState
        title="Nenhum mercado configurado"
        description="Cadastre um mercado e o canal do Instagram dele para começar a adaptar conteúdo."
        action={
          <Link href="/instagram/mercados" className="text-sm font-medium text-primary hover:underline">
            Ir para Mercados
          </Link>
        }
      />
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {perMarket.map((entry) => {
        const market = markets.get(entry.marketId);
        return (
          <li key={entry.marketId}>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <MarketChip market={market ?? undefined} fallbackId={entry.name} />
                {market?.status === 'paused' ? <Tag>Pausado</Tag> : null}
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-attention-soft/60 px-2 py-2">
                    <dt className="text-[0.6875rem] text-ink-muted">Aguardando</dt>
                    <dd className="text-lg font-semibold tabular-nums text-ink">
                      {entry.awaitingApproval}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-surface-sunken px-2 py-2">
                    <dt className="text-[0.6875rem] text-ink-muted">Hoje</dt>
                    <dd className="text-lg font-semibold tabular-nums text-ink">
                      {entry.scheduledToday}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-surface-sunken px-2 py-2">
                    <dt className="text-[0.6875rem] text-ink-muted">7 dias</dt>
                    <dd className="text-lg font-semibold tabular-nums text-ink">
                      {entry.publishedLast7Days}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-[0.6875rem] text-ink-subtle">
                  Aguardando aprovação, agendados hoje e publicados nos últimos 7 dias.
                </p>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Carregando início">
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-20 rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export function DashboardView() {
  const dashboard = useDashboard();
  const queue = useContentPieces({ status: 'awaiting_approval' });
  const allPieces = useContentPieces();
  const markets = useMarketIndex();
  const now = useNow();

  if (dashboard.isPending) return <DashboardSkeleton />;
  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }

  const data = dashboard.data;
  const pieceIndex = new Map((allPieces.data ?? []).map((piece) => [piece.id, piece]));

  return (
    <div className="space-y-6">
      <ReviewQueueHero
        count={data.counts.awaitingApproval}
        queue={queue.data ?? []}
        markets={markets}
        now={now}
      />
      <CounterStrip counts={data.counts} />
      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <NextPublications
          publications={data.nextPublications}
          pieces={pieceIndex}
          markets={markets}
          now={now}
        />
        <RecentActivity activity={data.recentActivity} now={now} />
      </div>
      <section aria-labelledby="markets-title" className="space-y-3">
        <h2 id="markets-title" className="font-display text-xl font-semibold text-ink">
          Mercados
        </h2>
        <MarketCards perMarket={data.perMarket} markets={markets} />
      </section>
    </div>
  );
}
