import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Channel, Publication } from '@sbs/contracts';

/** Dia do calendário como chave estável `yyyy-MM-dd`. */
export type DayKey = string;

const DAY_MS = 24 * 60 * 60 * 1000;

function keyToUtcDate(key: DayKey): Date {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDaysToKey(key: DayKey, days: number): DayKey {
  return new Date(keyToUtcDate(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Dia (no fuso indicado) em que um instante cai. */
export function dayKey(value: string | Date, timeZone: string): DayKey {
  const date = typeof value === 'string' ? new Date(value) : value;
  return format(new TZDate(date.getTime(), timeZone), 'yyyy-MM-dd');
}

/** Segunda-feira da semana que contém `date`, no fuso indicado. */
export function weekStartKey(date: Date, timeZone: string): DayKey {
  const today = dayKey(date, timeZone);
  const weekday = keyToUtcDate(today).getUTCDay(); // 0 = domingo
  const sinceMonday = (weekday + 6) % 7;
  return addDaysToKey(today, -sinceMonday);
}

export function weekDays(startKey: DayKey): DayKey[] {
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(startKey, index));
}

/** Meia-noite de um dia no fuso, como ISO UTC. */
export function startOfDayIso(key: DayKey, timeZone: string): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(new TZDate(year, month - 1, day, 0, 0, 0, timeZone).getTime()).toISOString();
}

/** Intervalo [segunda 00:00, próxima segunda 00:00) para o filtro da API. */
export function weekRange(startKey: DayKey, timeZone: string): { from: string; to: string } {
  return {
    from: startOfDayIso(startKey, timeZone),
    to: startOfDayIso(addDaysToKey(startKey, 7), timeZone),
  };
}

/** "13 a 19 de outubro de 2026" ou "29 de set. a 5 de outubro de 2026". */
export function weekLabel(startKey: DayKey): string {
  const start = keyToUtcDate(startKey);
  const end = keyToUtcDate(addDaysToKey(startKey, 6));
  const startUtc = new TZDate(start.getTime(), 'UTC');
  const endUtc = new TZDate(end.getTime(), 'UTC');
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startText = sameMonth
    ? format(startUtc, 'd', { locale: ptBR })
    : format(startUtc, "d 'de' MMM", { locale: ptBR });
  return `${startText} a ${format(endUtc, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
}

export function dayHeader(key: DayKey): { weekday: string; day: string } {
  const date = new TZDate(keyToUtcDate(key).getTime(), 'UTC');
  return {
    weekday: format(date, 'EEEEEE', { locale: ptBR }),
    day: format(date, 'd', { locale: ptBR }),
  };
}

export interface CalendarRow {
  channelId: string;
  marketId: string;
  channel: Channel | undefined;
  /** Publicações por dia, ordenadas por horário. */
  days: Record<DayKey, Publication[]>;
  total: number;
}

/**
 * Agrupa publicações em linhas por canal e colunas por dia (no fuso de quem vê).
 * Canais conhecidos aparecem mesmo sem publicações; publicações fora da semana são ignoradas.
 */
export function buildCalendarRows(
  publications: readonly Publication[],
  channels: readonly Channel[],
  days: readonly DayKey[],
  timeZone: string,
): CalendarRow[] {
  const rows = new Map<string, CalendarRow>();
  const emptyDays = () => Object.fromEntries(days.map((day) => [day, [] as Publication[]]));

  for (const channel of channels) {
    rows.set(channel.id, {
      channelId: channel.id,
      marketId: channel.marketId,
      channel,
      days: emptyDays(),
      total: 0,
    });
  }

  const sorted = [...publications].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  for (const publication of sorted) {
    const key = dayKey(publication.scheduledAt, timeZone);
    if (!days.includes(key)) continue;
    let row = rows.get(publication.channelId);
    if (!row) {
      row = {
        channelId: publication.channelId,
        marketId: publication.marketId,
        channel: undefined,
        days: emptyDays(),
        total: 0,
      };
      rows.set(publication.channelId, row);
    }
    row.days[key]?.push(publication);
    row.total += 1;
  }
  return [...rows.values()];
}

/** Pode reagendar ou cancelar? Espelha `Publication.reschedule` / `cancel` do domínio. */
export function canChangePublication(publication: Pick<Publication, 'status'>): boolean {
  return publication.status === 'scheduled' || publication.status === 'failed';
}

/** Um novo horário só vale se estiver no futuro em relação a `now`. */
export function isInFuture(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() > now.getTime();
}
