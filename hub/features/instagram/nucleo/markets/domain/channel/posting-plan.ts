import type { AdaptableFormat } from '@sbs/shared-kernel';
import { MarketErrors } from '../errors';

export interface PostingSlot {
  /** Hora local no fuso do mercado, `HH:mm`. */
  localTime: string;
  format: AdaptableFormat;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SLOTS = 10;

/** Grade diária de publicação de um canal, ordenada por horário. */
export class PostingPlan {
  private constructor(readonly slots: readonly PostingSlot[]) {}

  static of(slots: PostingSlot[]): PostingPlan {
    if (slots.length === 0) throw MarketErrors.invalidPostingPlan('informe ao menos um horário.');
    if (slots.length > MAX_SLOTS)
      throw MarketErrors.invalidPostingPlan(`no máximo ${MAX_SLOTS} horários por dia.`);

    const seen = new Set<string>();
    for (const slot of slots) {
      if (!TIME_PATTERN.test(slot.localTime))
        throw MarketErrors.invalidPostingPlan(`horário "${slot.localTime}" fora do formato HH:mm.`);
      if (slot.format !== 'reel' && slot.format !== 'carousel')
        throw MarketErrors.invalidPostingPlan(`formato "${String(slot.format)}" não é publicável.`);
      if (seen.has(slot.localTime))
        throw MarketErrors.invalidPostingPlan(`horário ${slot.localTime} repetido.`);
      seen.add(slot.localTime);
    }

    const sorted = [...slots]
      .map((s) => ({ localTime: s.localTime, format: s.format }))
      .sort((a, b) => a.localTime.localeCompare(b.localTime));
    return new PostingPlan(sorted);
  }

  /** 2 reels e 1 carrossel por dia. */
  static default(): PostingPlan {
    return PostingPlan.of([
      { localTime: '10:00', format: 'reel' },
      { localTime: '14:00', format: 'carousel' },
      { localTime: '20:00', format: 'reel' },
    ]);
  }

  countOf(format: AdaptableFormat): number {
    return this.slots.filter((s) => s.format === format).length;
  }
}
