import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium',
    'transition-colors duration-150 select-none',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-ink hover:bg-primary-hover shadow-card',
        secondary:
          'bg-surface text-ink border border-border hover:bg-surface-sunken hover:border-border-strong shadow-card',
        ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        approve: 'bg-success text-white hover:brightness-110 shadow-card dark:text-[#0d1a12]',
        changes:
          'bg-warning-soft text-warning-ink border border-warning/40 hover:border-warning hover:bg-warning-soft/70',
        danger:
          'bg-surface text-danger border border-danger/40 hover:bg-danger-soft hover:border-danger',
        'danger-solid': 'bg-danger text-white hover:brightness-110 dark:text-[#1f0c0c]',
        brass: 'bg-brass text-white hover:brightness-110 shadow-card dark:text-[#1d160a]',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-[0.8125rem]',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-5 text-[0.9375rem]',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
