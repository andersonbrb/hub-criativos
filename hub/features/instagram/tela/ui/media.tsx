'use client';

import { ImageOff, Images, Play } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { ContentFormat, Market } from '@sbs/contracts';
import { cn } from '@/features/instagram/tela/lib/cn';
import { marketHue, marketShortLabel } from '@/features/instagram/tela/lib/market-display';

export interface MediaThumbProps {
  src: string | null | undefined;
  alt: string;
  format?: ContentFormat;
  className?: string;
}

/** Miniatura 4:5 arredondada com indicador de formato e fallback quando a imagem falha. */
export function MediaThumb({ src, alt, format, className }: MediaThumbProps) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        'relative aspect-[4/5] overflow-hidden rounded-[10px] bg-surface-sunken',
        className,
      )}
    >
      {src && !failed ? (
        // URLs de mídia são arbitrárias (CDNs do Instagram e da plataforma de criativos): <img> simples.
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-ink-subtle">
          <ImageOff className="size-5" aria-label="Imagem indisponível" />
        </div>
      )}
      {format === 'reel' || format === 'carousel' ? (
        <span
          className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-[#0b0f15]/55 text-white backdrop-blur-sm"
          aria-hidden
        >
          {format === 'reel' ? (
            <Play className="size-3 fill-current" />
          ) : (
            <Images className="size-3" />
          )}
        </span>
      ) : null}
    </div>
  );
}

/** Chip de mercado: sigla com cor estável + nome. */
export function MarketChip({
  market,
  fallbackId,
  size = 'md',
  showName = true,
  className,
}: {
  market: Pick<Market, 'code' | 'locale' | 'name'> | undefined;
  fallbackId?: string;
  size?: 'sm' | 'md';
  showName?: boolean;
  className?: string;
}) {
  if (!market) {
    return (
      <span className={cn('text-xs text-ink-subtle', className)}>{fallbackId ?? 'Mercado'}</span>
    );
  }
  const hue = marketHue(market.code);
  const style = { '--market-hue': hue } as CSSProperties;
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
      style={style}
      title={market.name}
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded font-semibold tracking-wide',
          'bg-[hsl(var(--market-hue)_55%_92%)] text-[hsl(var(--market-hue)_55%_28%)]',
          'dark:bg-[hsl(var(--market-hue)_35%_22%)] dark:text-[hsl(var(--market-hue)_60%_82%)]',
          size === 'sm' ? 'h-4 px-1 text-[0.625rem]' : 'h-5 px-1.5 text-[0.6875rem]',
        )}
      >
        {marketShortLabel(market)}
      </span>
      {showName ? (
        <span
          className={cn('truncate font-medium text-ink', size === 'sm' ? 'text-xs' : 'text-sm')}
        >
          {market.name}
        </span>
      ) : null}
    </span>
  );
}
