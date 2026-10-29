'use client';

import { ChevronLeft, ChevronRight, Film } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { AdaptableFormat } from '@sbs/contracts';
import { cn } from '@/features/instagram/tela/lib/cn';

export type MediaSource =
  | { format: 'reel'; videoUrl: string | null; posterUrl: string | null }
  | { format: 'carousel'; slideUrls: readonly string[] };

export function ReelPlayer({
  videoUrl,
  posterUrl,
  label,
}: {
  videoUrl: string | null;
  posterUrl: string | null;
  label: string;
}) {
  if (!videoUrl) {
    return (
      <div className="mx-auto flex aspect-[9/16] max-h-[34rem] w-full max-w-[19rem] flex-col items-center justify-center gap-2 rounded-xl bg-surface-sunken text-sm text-ink-muted">
        <Film className="size-6" aria-hidden />
        Vídeo ainda não disponível
      </div>
    );
  }
  return (
    <video
      key={videoUrl}
      src={videoUrl}
      poster={posterUrl ?? undefined}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      className="mx-auto aspect-[9/16] max-h-[34rem] w-full max-w-[19rem] rounded-xl bg-black object-contain"
    />
  );
}

/** Visualizador de slides: botões, setas do teclado e gesto de arrastar. */
export function CarouselViewer({ slides, label }: { slides: readonly string[]; label: string }) {
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);
  const total = slides.length;
  const current = Math.min(index, Math.max(total - 1, 0));

  if (total === 0) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-xl bg-surface-sunken text-sm text-ink-muted">
        Slides ainda não disponíveis
      </div>
    );
  }

  const go = (next: number) => setIndex(Math.max(0, Math.min(total - 1, next)));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(current + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(current - 1);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    startX.current = event.clientX;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (startX.current === null) return;
    const delta = event.clientX - startX.current;
    startX.current = null;
    if (Math.abs(delta) < 40) return;
    go(current + (delta < 0 ? 1 : -1));
  }

  return (
    <div
      role="group"
      aria-roledescription="carrossel"
      aria-label={label}
      className="mx-auto w-full max-w-[24rem]"
    >
      <div
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="group relative aspect-[4/5] touch-pan-y overflow-hidden rounded-xl bg-surface-sunken select-none"
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {slides.map((src, slideIndex) => (
            <img
              key={`${src}-${slideIndex}`}
              src={src}
              alt={`Slide ${slideIndex + 1} de ${total}`}
              aria-hidden={slideIndex !== current}
              draggable={false}
              loading={slideIndex === 0 ? 'eager' : 'lazy'}
              className="h-full w-full shrink-0 object-cover"
            />
          ))}
        </div>
        <span className="absolute top-2 right-2 rounded-full bg-[#0b0f15]/60 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
          {current + 1}/{total}
        </span>
        {total > 1 ? (
          <>
            <button
              type="button"
              aria-label="Slide anterior"
              onClick={() => go(current - 1)}
              disabled={current === 0}
              className="absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#1a2130] shadow-pop transition-opacity disabled:opacity-0"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Próximo slide"
              onClick={() => go(current + 1)}
              disabled={current === total - 1}
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#1a2130] shadow-pop transition-opacity disabled:opacity-0"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      {total > 1 ? (
        <div className="mt-2.5 flex justify-center gap-1.5">
          {slides.map((src, slideIndex) => (
            <button
              key={`dot-${src}-${slideIndex}`}
              type="button"
              aria-label={`Ir para o slide ${slideIndex + 1}`}
              aria-current={slideIndex === current ? 'true' : undefined}
              onClick={() => go(slideIndex)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                slideIndex === current ? 'w-5 bg-primary' : 'w-1.5 bg-border-strong',
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MediaViewer({ media, label }: { media: MediaSource; label: string }) {
  if (media.format === 'reel') {
    return <ReelPlayer videoUrl={media.videoUrl} posterUrl={media.posterUrl} label={label} />;
  }
  return <CarouselViewer slides={media.slideUrls} label={label} />;
}

/** Monta a mídia do post original a partir da cópia guardada na peça. */
export function sourceMedia(
  format: AdaptableFormat,
  mediaUrls: readonly string[],
  thumbnailUrl: string,
): MediaSource {
  if (format === 'reel') {
    return { format, videoUrl: mediaUrls[0] ?? null, posterUrl: thumbnailUrl };
  }
  return { format, slideUrls: mediaUrls.length > 0 ? mediaUrls : [thumbnailUrl] };
}
