"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS, type Transform } from "@dnd-kit/utilities";
import { Package } from "lucide-react";

import { GenerationThumb, OperationBadge } from "@/components/pipeline/shared";
import type { BoardCard } from "@/lib/board";
import type { Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

const MAX_THUMBS = 3;

// O quadro usa CSS zoom: as medidas do dnd-kit vêm na escala da tela, mas o translate é aplicado
// dentro da área com zoom. Dividir pelo zoom faz o item andar exatamente com o ponteiro.
export function zoomed(transform: Transform | null, zoom: number): string | undefined {
  if (!transform) return undefined;
  return CSS.Translate.toString({ ...transform, x: transform.x / zoom, y: transform.y / zoom });
}

// Face do card, usada na coluna e no overlay do arraste. A cor da fase vem de --col (definida na coluna).
export function CardFace({
  card,
  generations,
  selected,
  overlay,
}: {
  card: BoardCard;
  generations: Map<string, Generation>;
  selected?: boolean;
  overlay?: boolean;
}) {
  const linked = card.generationIds.map((id) => generations.get(id)).filter((g): g is Generation => Boolean(g));
  const extra = card.generationIds.length - Math.min(linked.length, MAX_THUMBS);
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-l-4 border-l-[var(--col)] bg-card p-3 text-left shadow-sm transition-all",
        selected ? "border-rec ring-2 ring-rec/40" : "hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--col)_60%,transparent)] hover:shadow-md",
        overlay && "rotate-2 cursor-grabbing shadow-xl ring-1 ring-foreground/20",
      )}
    >
      <p className="line-clamp-3 text-sm leading-snug font-semibold break-words">{card.title}</p>
      {(card.operation || card.product) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <OperationBadge operation={card.operation} />
          {card.product && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <Package className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{card.product}</span>
            </span>
          )}
        </div>
      )}
      {card.generationIds.length > 0 && (
        <div className="flex items-center gap-1.5">
          {linked.slice(0, MAX_THUMBS).map((g) => (
            <GenerationThumb key={g.id} g={g} className="h-12 w-[1.6875rem]" />
          ))}
          {extra > 0 && <span className="font-mono text-[11px] text-muted-foreground tabular-nums">+{extra}</span>}
        </div>
      )}
    </div>
  );
}

export function SortableCard({
  card,
  columnId,
  generations,
  selected,
  onSelect,
  zoom,
}: {
  card: BoardCard;
  columnId: string;
  generations: Map<string, Generation>;
  selected: boolean;
  onSelect: (id: string) => void;
  zoom: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", columnId },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: zoomed(transform, zoom), transition }}
      {...attributes}
      {...listeners}
      aria-label={`Card ${card.title}`}
      aria-pressed={selected}
      onClick={() => onSelect(card.id)}
      onKeyDown={(e) => {
        // Enter seleciona; Espaço (via sensor de teclado) arrasta.
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onSelect(card.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      className={cn(
        "cursor-grab touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        isDragging && "opacity-40",
      )}
    >
      <CardFace card={card} generations={generations} selected={selected} />
    </div>
  );
}
