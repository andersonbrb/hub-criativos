'use client';

import type { AdaptableFormat } from '@sbs/contracts';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/features/instagram/tela/ui/button';
import { Input, Select } from '@/features/instagram/tela/ui/input';
import { cn } from '@/features/instagram/tela/lib/cn';
import { MAX_SLOTS, suggestNextRow, type PlanRow } from '../lib/posting-plan';

export interface PostingPlanEditorProps {
  rows: PlanRow[];
  onChange: (rows: PlanRow[]) => void;
  rowErrors?: Record<string, string>;
  formError?: string | null;
  disabled?: boolean;
}

/** Editor da grade diária: linhas de horário (HH:mm) + formato. */
export function PostingPlanEditor({
  rows,
  onChange,
  rowErrors = {},
  formError,
  disabled,
}: PostingPlanEditorProps) {
  function update(key: string, patch: Partial<PlanRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-ink">Grade de postagem</legend>
      <p className="text-xs text-ink-subtle">Horários diários no fuso do mercado.</p>
      <ul className="space-y-2">
        {rows.map((row, index) => {
          const error = rowErrors[row.key];
          const timeId = `slot-time-${row.key}`;
          return (
            <li key={row.key} className="space-y-1">
              <div className="flex items-center gap-2">
                <label htmlFor={timeId} className="sr-only">
                  Horário {index + 1}
                </label>
                <Input
                  id={timeId}
                  type="time"
                  value={row.localTime}
                  onChange={(event) => update(row.key, { localTime: event.target.value })}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${timeId}-error` : undefined}
                  className="w-32 tabular-nums"
                />
                <Select
                  aria-label={`Formato do horário ${index + 1}`}
                  value={row.format}
                  onChange={(event) =>
                    update(row.key, { format: event.target.value as AdaptableFormat })
                  }
                  className="w-40"
                >
                  <option value="reel">Reel</option>
                  <option value="carousel">Carrossel</option>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover horário ${index + 1}`}
                  onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
                  disabled={rows.length <= 1}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {error ? (
                <p id={`${timeId}-error`} role="alert" className="text-xs font-medium text-danger">
                  {error}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {formError ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className={cn('-ml-2', rows.length >= MAX_SLOTS && 'hidden')}
        onClick={() => onChange([...rows, suggestNextRow(rows)])}
      >
        <Plus aria-hidden />
        Adicionar horário
      </Button>
    </fieldset>
  );
}
