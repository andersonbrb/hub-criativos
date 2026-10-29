'use client';

import type { ContentPieceSummary, Market, Publication } from '@sbs/contracts';
import { CalendarX2, ChevronLeft, ChevronRight, Images, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/features/instagram/tela/ui/page-header';
import { Button } from '@/features/instagram/tela/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { MarketChip } from '@/features/instagram/tela/ui/media';
import { MarketSelect } from '@/features/instagram/tela/ui/market-select';
import {
  useChannelIndex,
  useChannels,
  useMarketIndex,
  useMarkets,
} from '@/features/instagram/tela/markets/hooks/use-markets';
import { useContentPieces } from '@/features/instagram/tela/pipeline/hooks/use-content-pieces';
import { cn } from '@/features/instagram/tela/lib/cn';
import { formatTime, timeZoneCity, timeZoneLabel, viewerTimeZone } from '@/features/instagram/tela/lib/format';
import { publicationStatusMeta, toneClasses } from '@/features/instagram/tela/lib/status';
import { useHydrated } from '@/features/instagram/tela/lib/use-hydrated';
import { useNow } from '@/features/instagram/tela/lib/use-now';
import { usePublications } from '../hooks/use-publications';
import {
  addDaysToKey,
  buildCalendarRows,
  dayHeader,
  dayKey,
  weekDays,
  weekLabel,
  weekRange,
  weekStartKey,
  type CalendarRow,
} from '../lib/week';
import { PublicationDialog } from './publication-dialog';

function PublicationChip({
  publication,
  market,
  viewerTz,
  onOpen,
}: {
  publication: Publication;
  market: Market | undefined;
  viewerTz: string;
  onOpen: () => void;
}) {
  const meta = publicationStatusMeta[publication.status];
  const marketTz = market?.timezone ?? viewerTz;
  const differentTz = marketTz !== viewerTz;
  const Icon = publication.format === 'reel' ? Play : Images;
  const local = formatTime(publication.scheduledAt, marketTz);
  const mine = formatTime(publication.scheduledAt, viewerTz);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${meta.label}, ${local} em ${timeZoneCity(marketTz)}${differentTz ? `, ${mine} no seu horário` : ''}`}
      className={cn(
        'flex w-full items-start gap-1.5 rounded-md border-l-[3px] bg-surface px-2 py-1.5 text-left shadow-card transition-colors hover:bg-surface-raised',
        toneClasses[meta.tone].border,
        publication.status === 'cancelled' && 'opacity-60',
      )}
    >
      <Icon className="mt-0.5 size-3 shrink-0 text-ink-subtle" aria-hidden />
      <span className="min-w-0 leading-tight">
        <span
          className={cn(
            'block text-[0.8125rem] font-semibold tabular-nums text-ink',
            publication.status === 'cancelled' && 'line-through',
          )}
        >
          {local}
        </span>
        {differentTz ? (
          <span className="block text-[0.6875rem] text-ink-subtle tabular-nums">{mine} aqui</span>
        ) : null}
      </span>
    </button>
  );
}

function CalendarSkeleton() {
  return (
    <div className="space-y-2" aria-busy aria-label="Carregando calendário">
      <Skeleton className="h-10" />
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Legenda">
      {Object.entries(publicationStatusMeta).map(([status, meta]) => (
        <li key={status} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2 rounded-full', toneClasses[meta.tone].dot)} />
          {meta.label}
        </li>
      ))}
    </ul>
  );
}

export function CalendarView() {
  // A semana e os horários dependem do fuso do navegador: renderiza só no cliente.
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <div>
        <PageHeader title="Calendário" />
        <CalendarSkeleton />
      </div>
    );
  }
  return <WeekCalendar />;
}

function WeekCalendar() {
  const viewerTz = viewerTimeZone();
  const now = useNow();
  const todayKey = dayKey(now, viewerTz);
  const [start, setStart] = useState(() => weekStartKey(new Date(), viewerTz));
  const [marketId, setMarketId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const days = useMemo(() => weekDays(start), [start]);
  const range = useMemo(() => weekRange(start, viewerTz), [start, viewerTz]);
  const publications = usePublications(range);
  const channelsQuery = useChannels();
  const markets = useMarkets();
  const marketIndex = useMarketIndex();
  const channelIndex = useChannelIndex();
  const pieces = useContentPieces();

  const rows: CalendarRow[] = useMemo(() => {
    const all = buildCalendarRows(
      publications.data ?? [],
      channelsQuery.data ?? [],
      days,
      viewerTz,
    );
    const filtered = marketId ? all.filter((row) => row.marketId === marketId) : all;
    return filtered.sort((a, b) =>
      (marketIndex.get(a.marketId)?.name ?? a.marketId).localeCompare(
        marketIndex.get(b.marketId)?.name ?? b.marketId,
        'pt-BR',
      ),
    );
  }, [publications.data, channelsQuery.data, days, viewerTz, marketId, marketIndex]);

  const pieceIndex = useMemo(
    () =>
      new Map((pieces.data ?? []).map((piece): [string, ContentPieceSummary] => [piece.id, piece])),
    [pieces.data],
  );
  const open = (publications.data ?? []).find((publication) => publication.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Calendário"
        description={`Horários no fuso de cada mercado. Quando o fuso é diferente do seu (${timeZoneLabel(viewerTz, now)}), mostramos também o seu horário.`}
        actions={
          <MarketSelect markets={markets.data ?? []} value={marketId} onChange={setMarketId} />
        }
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            aria-label="Semana anterior"
            onClick={() => setStart((current) => addDaysToKey(current, -7))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button onClick={() => setStart(weekStartKey(new Date(), viewerTz))}>Hoje</Button>
          <Button
            size="icon"
            aria-label="Próxima semana"
            onClick={() => setStart((current) => addDaysToKey(current, 7))}
          >
            <ChevronRight aria-hidden />
          </Button>
          <h2 className="ml-2 font-display text-lg font-semibold text-ink" aria-live="polite">
            {weekLabel(start)}
          </h2>
        </div>
        <Legend />
      </div>

      {publications.isPending || channelsQuery.isPending ? (
        <CalendarSkeleton />
      ) : publications.isError ? (
        <ErrorState error={publications.error} onRetry={() => void publications.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarX2 />}
          title="Nenhum canal para mostrar"
          description="Cadastre um canal do Instagram em Mercados para ver a agenda de publicações."
        />
      ) : (
        <div className="scrollbar-thin overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[60rem] table-fixed border-collapse">
            <caption className="sr-only">Publicações da semana por canal e dia</caption>
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="w-48 px-4 py-2.5 text-left text-xs font-medium text-ink-muted"
                >
                  Canal
                </th>
                {days.map((day) => {
                  const header = dayHeader(day);
                  const isToday = day === todayKey;
                  return (
                    <th
                      key={day}
                      scope="col"
                      className={cn(
                        'px-2 py-2.5 text-left text-xs font-medium text-ink-muted',
                        isToday && 'bg-primary-soft/60',
                      )}
                    >
                      <span className="capitalize">{header.weekday}</span>{' '}
                      <span
                        className={cn(
                          'ml-0.5 inline-flex size-6 items-center justify-center rounded-full text-sm tabular-nums',
                          isToday ? 'bg-primary font-semibold text-primary-ink' : 'text-ink',
                        )}
                        aria-current={isToday ? 'date' : undefined}
                      >
                        {header.day}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const market = marketIndex.get(row.marketId);
                return (
                  <tr key={row.channelId} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-left align-top font-normal">
                      <MarketChip market={market} fallbackId={row.marketId} size="sm" />
                      <p className="mt-1 truncate text-xs text-ink-muted">
                        {row.channel ? `@${row.channel.handle}` : 'Canal removido'}
                      </p>
                      {market ? (
                        <p className="text-[0.6875rem] text-ink-subtle">
                          {timeZoneLabel(market.timezone, now)}
                        </p>
                      ) : null}
                    </th>
                    {days.map((day) => (
                      <td
                        key={day}
                        className={cn(
                          'border-l border-border px-1.5 py-2 align-top',
                          day === todayKey && 'bg-primary-soft/30',
                        )}
                      >
                        <ul className="space-y-1.5">
                          {(row.days[day] ?? []).map((publication) => (
                            <li key={publication.id}>
                              <PublicationChip
                                publication={publication}
                                market={market}
                                viewerTz={viewerTz}
                                onOpen={() => setOpenId(publication.id)}
                              />
                            </li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PublicationDialog
        publication={open}
        market={open ? marketIndex.get(open.marketId) : undefined}
        channel={open ? channelIndex.get(open.channelId) : undefined}
        piece={open ? pieceIndex.get(open.contentPieceId) : undefined}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
