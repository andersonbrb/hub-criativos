import {
  LocalTimeSchema,
  UpdatePostingPlanInputSchema,
  type AdaptableFormat,
  type PostingSlot,
} from '@sbs/contracts';

/** Limites do objeto de valor `PostingPlan` no domínio. */
export const MIN_SLOTS = 1;
export const MAX_SLOTS = 10;

/** Grade padrão: reel 10:00, carrossel 14:00, reel 20:00 (2 reels + 1 carrossel). */
export const DEFAULT_POSTING_PLAN: readonly PostingSlot[] = [
  { localTime: '10:00', format: 'reel' },
  { localTime: '14:00', format: 'carousel' },
  { localTime: '20:00', format: 'reel' },
];

export interface PlanRow {
  /** Chave estável para a lista do React. */
  key: string;
  localTime: string;
  format: AdaptableFormat;
}

let rowCounter = 0;
export function newRowKey(): string {
  rowCounter += 1;
  return `slot-${rowCounter}`;
}

export function toRows(plan: readonly PostingSlot[]): PlanRow[] {
  return plan.map((slot) => ({ key: newRowKey(), ...slot }));
}

/** Sugere o próximo horário livre (3h depois do último, sem passar de 23:00). */
export function suggestNextRow(rows: readonly PlanRow[]): PlanRow {
  const taken = new Set(rows.map((row) => row.localTime));
  const last = [...rows]
    .map((row) => row.localTime)
    .sort()
    .pop();
  let hour = last ? Math.min(Number(last.slice(0, 2)) + 3, 23) : 10;
  let candidate = `${String(hour).padStart(2, '0')}:00`;
  while (taken.has(candidate) && hour > 0) {
    hour -= 1;
    candidate = `${String(hour).padStart(2, '0')}:00`;
  }
  return { key: newRowKey(), localTime: candidate, format: 'reel' };
}

export type PlanValidation =
  | { ok: true; plan: PostingSlot[] }
  | { ok: false; formError: string | null; rowErrors: Record<string, string> };

/**
 * Valida a grade como o domínio: 1 a 10 horários `HH:mm`, sem repetição.
 * Devolve a grade ordenada por horário, pronta para `UpdatePostingPlanInput`.
 */
export function validatePostingPlan(rows: readonly PlanRow[]): PlanValidation {
  const rowErrors: Record<string, string> = {};
  let formError: string | null = null;

  if (rows.length < MIN_SLOTS) formError = 'Adicione pelo menos um horário.';
  else if (rows.length > MAX_SLOTS) formError = `Use no máximo ${MAX_SLOTS} horários por dia.`;

  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!LocalTimeSchema.safeParse(row.localTime).success) {
      rowErrors[row.key] = 'Use o formato HH:mm (ex.: 09:30).';
      continue;
    }
    const firstKey = seen.get(row.localTime);
    if (firstKey) {
      rowErrors[row.key] = `O horário ${row.localTime} já está na grade.`;
    } else {
      seen.set(row.localTime, row.key);
    }
  }

  if (formError || Object.keys(rowErrors).length > 0) {
    return { ok: false, formError, rowErrors };
  }

  const plan = rows
    .map(({ localTime, format }) => ({ localTime, format }))
    .sort((a, b) => a.localTime.localeCompare(b.localTime));
  const parsed = UpdatePostingPlanInputSchema.safeParse({ postingPlan: plan });
  if (!parsed.success) {
    return { ok: false, formError: 'A grade é inválida.', rowErrors };
  }
  return { ok: true, plan: parsed.data.postingPlan };
}

/** Resumo legível: "2 reels e 1 carrossel por dia". */
export function summarizePlan(plan: readonly PostingSlot[]): string {
  const reels = plan.filter((slot) => slot.format === 'reel').length;
  const carousels = plan.length - reels;
  const parts: string[] = [];
  if (reels > 0) parts.push(`${reels} ${reels === 1 ? 'reel' : 'reels'}`);
  if (carousels > 0) parts.push(`${carousels} ${carousels === 1 ? 'carrossel' : 'carrosséis'}`);
  return parts.length > 0 ? `${parts.join(' e ')} por dia` : 'Sem horários';
}
