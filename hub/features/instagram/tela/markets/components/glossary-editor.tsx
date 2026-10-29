'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/features/instagram/tela/ui/button';
import { Input } from '@/features/instagram/tela/ui/input';
import { newGlossaryRow, type FieldErrors, type GlossaryRow } from '../lib/market-form';

export function GlossaryEditor({
  rows,
  onChange,
  errors,
}: {
  rows: GlossaryRow[];
  onChange: (rows: GlossaryRow[]) => void;
  errors: FieldErrors;
}) {
  function update(key: string, patch: Partial<GlossaryRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  // Índices de erro contam só linhas preenchidas (as vazias são descartadas ao validar).
  const filled = rows.filter((row) => row.source.trim() || row.target.trim());

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">Glossário</legend>
      <p className="text-xs text-ink-subtle">
        Como traduzir termos fixos (ex.: São Bento para San Benito).
      </p>
      {rows.length > 0 ? (
        <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span>Original (pt-BR)</span>
          <span>No mercado</span>
          <span className="w-8" />
        </div>
      ) : null}
      <ul className="space-y-2">
        {rows.map((row, index) => {
          const filledIndex = filled.indexOf(row);
          const sourceError =
            filledIndex >= 0 ? errors[`glossary.${filledIndex}.source`] : undefined;
          const targetError =
            filledIndex >= 0 ? errors[`glossary.${filledIndex}.target`] : undefined;
          return (
            <li key={row.key} className="space-y-1">
              <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input
                  aria-label={`Termo original ${index + 1}`}
                  value={row.source}
                  onChange={(event) => update(row.key, { source: event.target.value })}
                  aria-invalid={sourceError ? true : undefined}
                />
                <Input
                  aria-label={`Tradução ${index + 1}`}
                  value={row.target}
                  onChange={(event) => update(row.key, { target: event.target.value })}
                  aria-invalid={targetError ? true : undefined}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover termo ${index + 1}`}
                  onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {sourceError || targetError ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {sourceError ?? targetError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="-ml-2"
        onClick={() => onChange([...rows, newGlossaryRow()])}
      >
        <Plus aria-hidden />
        Adicionar termo
      </Button>
    </fieldset>
  );
}

/** Entrada de termos em chips: Enter ou vírgula adiciona, Backspace no vazio remove o último. */
export function TermsInput({
  label,
  hint,
  terms,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  terms: string[];
  onChange: (terms: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState('');
  const inputId = 'forbidden-terms-input';

  function commit() {
    const value = draft.trim().replace(/,$/, '').trim();
    if (!value) return;
    if (!terms.some((term) => term.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      onChange([...terms, value]);
    }
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && terms.length > 0) {
      onChange(terms.slice(0, -1));
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 focus-within:border-ring">
        {terms.map((term) => (
          <span
            key={term}
            className="inline-flex items-center gap-1 rounded-md bg-danger-soft py-0.5 pr-1 pl-2 text-xs font-medium text-danger-ink"
          >
            {term}
            <button
              type="button"
              aria-label={`Remover ${term}`}
              onClick={() => onChange(terms.filter((entry) => entry !== term))}
              className="rounded p-0.5 hover:bg-danger/15"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={terms.length === 0 ? 'Digite e tecle Enter' : ''}
          className="min-w-32 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
