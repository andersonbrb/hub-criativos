import type { ComponentProps } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';
import { toneClasses, type StatusMeta, type StatusTone } from '@/features/instagram/tela/lib/status';

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: StatusTone;
  /** Mostra o ponto colorido antes do texto. */
  dot?: boolean;
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  const classes = toneClasses[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        classes.badge,
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', classes.dot)} /> : null}
      {children}
    </span>
  );
}

/** Badge de status a partir dos metadados centralizados em `lib/status`. */
export function StatusBadge({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <Badge tone={meta.tone} dot className={className} title={meta.description || undefined}>
      {meta.label}
    </Badge>
  );
}

/** Rótulo discreto e neutro (formato, revisão, contagem). */
export function Tag({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-muted [&_svg]:size-3',
        className,
      )}
      {...props}
    />
  );
}
