import { AlertTriangle, RotateCw } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { cn } from '@/features/instagram/tela/lib/cn';
import { Button } from './button';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-shimmer rounded-md bg-surface-sunken', className)}
      {...props}
    />
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Tela vazia que orienta o próximo passo. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong/70 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-sunken text-ink-muted [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

/** Erro de carregamento com o motivo e um botão para tentar de novo. */
export function ErrorState({
  error,
  title = 'Não foi possível carregar',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-danger/30 bg-danger-soft/40 px-6 py-10 text-center',
        className,
      )}
    >
      <AlertTriangle className="mb-2 size-5 text-danger" aria-hidden />
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/25 px-1 font-sans text-[0.6875rem] font-semibold',
        className,
      )}
      {...props}
    />
  );
}

/** Aviso em linha (erros de formulário, avisos de estado). */
export function InlineAlert({
  tone = 'danger',
  title,
  children,
  className,
  icon,
}: {
  tone?: 'danger' | 'warning' | 'info' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const tones = {
    danger: 'border-danger/35 bg-danger-soft text-danger-ink',
    warning: 'border-warning/35 bg-warning-soft text-warning-ink',
    info: 'border-info/35 bg-info-soft text-info-ink',
    success: 'border-success/35 bg-success-soft text-success-ink',
  } as const;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', tones[tone], className)}
    >
      {icon ? <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div> : null}
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}
