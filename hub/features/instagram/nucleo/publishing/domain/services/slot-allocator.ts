import { TZDate } from '@date-fns/tz';
import type { AdaptableFormat } from '@sbs/shared-kernel';
import { PublishingErrors } from '../errors';

export interface PostingSlot {
  /** Hora local no fuso do mercado, `HH:mm`. */
  localTime: string;
  format: AdaptableFormat;
}

export interface NextSlotInput {
  format: AdaptableFormat;
  postingPlan: readonly PostingSlot[];
  /** Fuso IANA do mercado, ex.: `Europe/Paris`. */
  timezone: string;
  /** Horários já ocupados no canal (instantes exatos). */
  taken: readonly Date[];
  now: Date;
  /** Antecedência mínima entre agora e o horário escolhido. */
  leadMinutes?: number;
  /** Quantos dias à frente procurar antes de desistir. */
  horizonDays?: number;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Escolhe o próximo horário livre da grade de um canal.
 *
 * A grade é hora de parede no fuso do mercado ("reel às 10:00 em Paris"), então cada
 * slot é convertido para um instante com `TZDate`, que aplica o horário de verão do dia.
 */
export class SlotAllocator {
  static nextSlot({
    format,
    postingPlan,
    timezone,
    taken,
    now,
    leadMinutes = 15,
    horizonDays = 14,
  }: NextSlotInput): Date {
    const times = postingPlan
      .filter((slot) => slot.format === format)
      .map((slot) => parseLocalTime(slot.localTime))
      .sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes));

    const earliest = now.getTime() + leadMinutes * MINUTE_MS;
    const latest = now.getTime() + horizonDays * DAY_MS;
    const occupied = new Set(taken.map((d) => d.getTime()));
    const today = new TZDate(now.getTime(), timezone);

    for (let day = 0; day <= horizonDays; day += 1) {
      for (const { hours, minutes } of times) {
        // O construtor normaliza dia excedente (31 + 1 → 1º do mês seguinte).
        const candidate = new TZDate(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() + day,
          hours,
          minutes,
          timezone,
        ).getTime();
        if (candidate > latest) throw PublishingErrors.noSlotAvailable(format, horizonDays);
        if (candidate >= earliest && !occupied.has(candidate)) return new Date(candidate);
      }
    }
    throw PublishingErrors.noSlotAvailable(format, horizonDays);
  }
}

function parseLocalTime(localTime: string): { hours: number; minutes: number } {
  const match = TIME_PATTERN.exec(localTime);
  if (!match) throw PublishingErrors.invalidPostingSlot(localTime);
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}
