import type { ComponentProps } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

export const controlClasses = cn(
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle',
  'transition-colors hover:border-border-strong',
  'focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger/30',
);

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClasses, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(controlClasses, 'min-h-24 resize-y py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

/** Select nativo estilizado: acessível, funciona com teclado e leitor de tela sem esforço. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        controlClasses,
        'h-9 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237b8494' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
