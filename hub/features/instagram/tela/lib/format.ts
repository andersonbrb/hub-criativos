import { TZDate } from '@date-fns/tz';
import { format, formatDistanceStrict, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/** Fuso do navegador de quem está vendo o painel. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function inZone(value: string | Date, timeZone?: string): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  return timeZone ? new TZDate(date.getTime(), timeZone) : date;
}

/** "15 out 2026, 14:30" */
export function formatDateTime(value: string | Date, timeZone?: string): string {
  return format(inZone(value, timeZone), 'd MMM yyyy, HH:mm', { locale: ptBR });
}

/** "15 de outubro de 2026" */
export function formatLongDate(value: string | Date, timeZone?: string): string {
  return format(inZone(value, timeZone), "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

/** "qua, 15 out" */
export function formatShortDay(value: string | Date, timeZone?: string): string {
  return format(inZone(value, timeZone), 'EEE, d MMM', { locale: ptBR });
}

/** "14:30" */
export function formatTime(value: string | Date, timeZone?: string): string {
  return format(inZone(value, timeZone), 'HH:mm', { locale: ptBR });
}

/** "hoje, 14:30" · "amanhã, 10:00" · "qua, 15 out, 14:30" */
export function formatSchedule(iso: string, now: Date, timeZone?: string): string {
  const date = inZone(iso, timeZone);
  const today = inZone(now, timeZone);
  const tomorrow = inZone(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone);
  const time = format(date, 'HH:mm');
  if (isSameDay(date, today)) return `hoje, ${time}`;
  if (isSameDay(date, tomorrow)) return `amanhã, ${time}`;
  return `${format(date, 'EEE, d MMM', { locale: ptBR })}, ${time}`;
}

/** "há 5 minutos" · "em 2 horas" · "agora mesmo" */
export function formatRelative(value: string | Date, now: Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = Math.abs(date.getTime() - now.getTime());
  if (diff < 45_000) return 'agora mesmo';
  return formatDistanceStrict(date, now, { locale: ptBR, addSuffix: true });
}

const integerFormatter = new Intl.NumberFormat('pt-BR');
const compactFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const scoreFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** "12.345" */
export function formatNumber(value: number): string {
  return integerFormatter.format(value);
}

/** Abaixo de 10 mil mostra o número inteiro ("9.870"); acima, compacto ("12,3 mil"). */
export function formatCompact(value: number): string {
  if (Math.abs(value) < 10_000) return integerFormatter.format(value);
  return compactFormatter.format(value);
}

/** Pontuação com até uma casa decimal: "87,5". */
export function formatScore(value: number): string {
  return scoreFormatter.format(value);
}

/** Deslocamento do fuso numa data: "UTC+2", "UTC−3", "UTC+5:30". */
export function timeZoneOffsetLabel(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = raw.replace('GMT', '');
  if (offset === '' || offset === '+0') return 'UTC';
  return `UTC${offset.replace('-', '−')}`;
}

/** Nome curto da cidade do fuso IANA: "America/Mexico_City" → "Mexico City". */
export function timeZoneCity(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}

/** "Paris (UTC+2)" */
export function timeZoneLabel(timeZone: string, at: Date): string {
  return `${timeZoneCity(timeZone)} (${timeZoneOffsetLabel(timeZone, at)})`;
}

/** Valor para `<input type="datetime-local">` no fuso indicado: "2026-10-15T14:30". */
export function toDateTimeLocalValue(iso: string, timeZone: string): string {
  return format(new TZDate(new Date(iso).getTime(), timeZone), "yyyy-MM-dd'T'HH:mm");
}

/** Converte "2026-10-15T14:30" (hora local no fuso) em ISO UTC. `null` se inválido. */
export function fromDateTimeLocalValue(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new TZDate(year, month - 1, day, hour, minute, 0, timeZone);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime()).toISOString();
}

/** Corta um texto em `max` caracteres sem quebrar palavras. */
export function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
