'use client';

import type { ContentPieceSummary, Market } from '@sbs/contracts';
import { CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/features/instagram/tela/ui/button';
import { Kbd } from '@/features/instagram/tela/ui/feedback';
import { MediaThumb } from '@/features/instagram/tela/ui/media';
import { formatRelative } from '@/features/instagram/tela/lib/format';
import type { MarketIndex } from '@/features/instagram/tela/lib/market-display';

interface ReviewQueueHeroProps {
  count: number;
  queue: readonly ContentPieceSummary[];
  markets: MarketIndex;
  now: Date;
}

function queueMarkets(queue: readonly ContentPieceSummary[], markets: MarketIndex): Market[] {
  const seen = new Map<string, Market>();
  for (const piece of queue) {
    const market = markets.get(piece.marketId);
    if (market) seen.set(market.id, market);
  }
  return [...seen.values()];
}

/** Destaque da tela inicial: a fila de revisão e o atalho para começar. */
export function ReviewQueueHero({ count, queue, markets, now }: ReviewQueueHeroProps) {
  if (count === 0) {
    return (
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface px-6 py-7 shadow-card sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex items-center gap-4">
          <span className="flex size-11 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">Fila de revisão zerada</h1>
            <p className="text-sm text-ink-muted">
              Novas adaptações aparecem aqui assim que passam pela revisão automática.
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/instagram/producao">Abrir a produção</Link>
        </Button>
      </section>
    );
  }

  const oldest = [...queue].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
  const marketsInQueue = queueMarkets(queue, markets);
  const preview = queue.slice(0, 4);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-attention/35 bg-surface shadow-card">
      <div aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-brass" />
      <div className="flex flex-col gap-6 px-6 py-7 md:flex-row md:items-center md:justify-between md:px-9">
        <div className="space-y-2">
          <h1 className="font-display text-[2rem] leading-tight font-semibold text-ink">
            {count === 1
              ? '1 peça aguardando sua aprovação'
              : `${count} peças aguardando sua aprovação`}
          </h1>
          <p className="max-w-[60ch] text-sm text-ink-muted">
            {marketsInQueue.length > 0
              ? `Para ${marketsInQueue.map((market) => market.name).join(', ')}. `
              : null}
            {oldest ? `A mais antiga chegou ${formatRelative(oldest.updatedAt, now)}.` : null}
          </p>
          <p className="hidden items-center gap-1.5 text-xs text-ink-subtle md:flex">
            Na revisão, use <Kbd>A</Kbd> para aprovar, <Kbd>J</Kbd> para voltar para a edição e{' '}
            <Kbd>R</Kbd> para reprovar.
          </p>
        </div>
        <div className="flex items-center gap-5">
          {preview.length > 0 ? (
            <div className="hidden -space-x-5 sm:flex" aria-hidden>
              {preview.map((piece, index) => (
                // Leque leve: cada miniatura um pouco mais inclinada.
                <div key={piece.id} style={{ transform: `rotate(${(index - 1.5) * 4}deg)` }}>
                  <MediaThumb
                    src={piece.thumbnailUrl}
                    alt=""
                    className="w-14 rounded-lg ring-2 ring-surface"
                  />
                </div>
              ))}
            </div>
          ) : null}
          {oldest ? (
            <Button asChild variant="brass" size="lg">
              <Link href={`/instagram/conteudos/${oldest.id}`}>Revisar agora</Link>
            </Button>
          ) : (
            <Button asChild variant="brass" size="lg">
              <Link href="/instagram/producao">Revisar agora</Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
