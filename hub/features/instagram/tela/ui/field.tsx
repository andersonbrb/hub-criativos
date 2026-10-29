'use client';

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/features/instagram/tela/lib/cn';

interface ControlProps {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string;
  /** Um único controle (Input, Textarea, Select). Recebe `id` e atributos ARIA. */
  children: ReactElement<ControlProps>;
  required?: boolean;
}

/** Rótulo + controle + dica + erro, com ids e ARIA ligados. */
export function Field({ label, hint, error, className, children, required }: FieldProps) {
  const autoId = useId();
  const id = children.props.id ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })
    : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
