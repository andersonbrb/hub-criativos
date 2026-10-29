'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'scrollbar-thin flex items-center gap-1 overflow-x-auto border-b border-border',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-ink-muted',
        'hover:text-ink data-[state=active]:border-primary data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4', className)} {...props} />;
}
