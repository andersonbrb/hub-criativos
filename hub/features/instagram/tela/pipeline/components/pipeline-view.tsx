'use client';

import { Inbox, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/features/instagram/tela/ui/page-header';
import { Button } from '@/features/instagram/tela/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { MarketSelect } from '@/features/instagram/tela/ui/market-select';
import { useMarketIndex, useMarkets } from '@/features/instagram/tela/markets/hooks/use-markets';
import { cn } from '@/features/instagram/tela/lib/cn';
import { toneClasses } from '@/features/instagram/tela/lib/status';
import { useNow } from '@/features/instagram/tela/lib/use-now';
import { useContentPieces } from '../hooks/use-content-pieces';
import { groupPieces, pipelineColumns } from '../lib/group-pieces';
import { PipelineCard } from './pipeline-card';

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden" aria-busy aria-label="Carregando pipeline">
      {pipelineColumns.map((column) => (
        <div key={column.id} className="w-72 shrink-0 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function PipelineView() {
  const [marketId, setMarketId] = useState('');
  const pieces = useContentPieces();
  const markets = useMarkets();
  const marketIndex = useMarketIndex();
  const now = useNow();

  const columns = useMemo(
    () => groupPieces(pieces.data ?? [], marketId || null),
    [pieces.data, marketId],
  );
  const total = columns.reduce((sum, column) => sum + column.items.length, 0);
  const firstAwaiting = columns.find((column) => column.id === 'awaiting_approval')?.items[0];

  return (
    <div>
      <PageHeader
        title="Produção"
        description="Cada adaptação, da produção à publicação. Abra um card para revisar."
        actions={
          <>
            <MarketSelect markets={markets.data ?? []} value={marketId} onChange={setMarketId} />
            {firstAwaiting ? (
              <Button asChild variant="brass">
                <Link href={`/instagram/conteudos/${firstAwaiting.id}`}>Revisar a próxima</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {pieces.isPending ? (
        <BoardSkeleton />
      ) : pieces.isError ? (
        <ErrorState error={pieces.error} onRetry={() => void pieces.refetch()} />
      ) : (pieces.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Nenhuma adaptação ainda"
          description="Selecione posts de referência para que as adaptações de cada mercado comecem a ser produzidas."
          action={
            <Button asChild variant="primary">
              <Link href="/instagram/referencias">Ir para Referências</Link>
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          icon={<Search />}
          title="Nada neste mercado"
          description="Nenhuma adaptação para o mercado escolhido. Troque o filtro para ver os outros."
          action={<Button onClick={() => setMarketId('')}>Ver todos os mercados</Button>}
        />
      ) : (
        <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
          <div className="flex min-w-max gap-4">
            {columns.map((column) => (
              <section
                key={column.id}
                aria-labelledby={`col-${column.id}`}
                className={cn(
                  'flex w-72 shrink-0 flex-col rounded-xl bg-surface-sunken/70 p-2',
                  column.id === 'awaiting_approval' &&
                    'bg-attention-soft/60 ring-1 ring-attention/30',
                )}
              >
                <header className="flex items-center gap-2 px-1.5 pt-1 pb-2.5">
                  <span
                    aria-hidden
                    className={cn('size-2 rounded-full', toneClasses[column.tone].dot)}
                  />
                  <h2 id={`col-${column.id}`} className="flex-1 text-sm font-semibold text-ink">
                    {column.title}
                  </h2>
                  <span className="rounded-full bg-surface px-2 text-xs font-medium text-ink-muted tabular-nums">
                    {column.items.length}
                  </span>
                </header>
                {column.items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-ink-subtle">
                    {column.emptyText}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {column.items.map((piece) => (
                      <li key={piece.id}>
                        <PipelineCard
                          piece={piece}
                          market={marketIndex.get(piece.marketId)}
                          now={now}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
