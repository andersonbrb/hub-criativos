import type { ComponentProps } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-surface shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-3', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-[0.9375rem] font-semibold text-ink', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-ink-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}
