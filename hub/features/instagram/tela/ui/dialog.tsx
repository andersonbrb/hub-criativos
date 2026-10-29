'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  'title'
> {
  title: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function DialogContent({
  title,
  description,
  size = 'md',
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0b0f15]/45 backdrop-blur-[2px] data-[state=open]:animate-ig-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[min(90vh,52rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-2xl border border-border bg-surface-raised shadow-pop data-[state=open]:animate-ig-pop-in',
          sizes[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div className="space-y-1">
            <DialogPrimitive.Title className="font-display text-xl font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mr-2 rounded-md p-1.5 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            aria-label="Fechar"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pt-4 pb-6">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
