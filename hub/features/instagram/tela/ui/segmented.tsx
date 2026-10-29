'use client';

import type { ReactNode } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  label: string;
  className?: string;
}

/** Filtro de opções exclusivas (grupo de rádio com aparência de abas). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[0.8125rem] font-medium transition-colors',
              active ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.6875rem] tabular-nums',
                  active ? 'bg-surface-sunken text-ink' : 'text-ink-subtle',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
