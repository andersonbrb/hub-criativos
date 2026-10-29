'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/** Tooltip simples. O filho precisa aceitar ref e foco (botão, link ou `span tabIndex=0`). */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-lg bg-ink px-3 py-2 text-xs leading-relaxed text-bg shadow-pop data-[state=delayed-open]:animate-ig-fade-in',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-ink" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
