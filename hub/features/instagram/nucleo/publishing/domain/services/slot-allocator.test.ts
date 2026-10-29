import { DomainError } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { SlotAllocator, type NextSlotInput, type PostingSlot } from './slot-allocator';

const defaultPlan: PostingSlot[] = [
  { localTime: '10:00', format: 'reel' },
  { localTime: '14:00', format: 'carousel' },
  { localTime: '20:00', format: 'reel' },
];

const next = (input: Partial<NextSlotInput> & Pick<NextSlotInput, 'now' | 'timezone'>) =>
  SlotAllocator.nextSlot({
    format: 'reel',
    postingPlan: defaultPlan,
    taken: [],
    ...input,
  }).toISOString();

const at = (iso: string) => new Date(iso);

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('SlotAllocator', () => {
  describe('Europe/Paris (horário de verão termina em 2026-10-25)', () => {
    const timezone = 'Europe/Paris';

    it('antes da mudança, 10:00 local é 08:00 UTC (CEST, +2)', () => {
      expect(next({ timezone, now: at('2026-10-24T07:00:00Z') })).toBe('2026-10-24T08:00:00.000Z');
    });

    it('atravessa a mudança: 10:00 local do dia 25 é 09:00 UTC (CET, +1)', () => {
      // 21:00 de sábado em Paris: os reels de sábado já passaram.
      expect(next({ timezone, now: at('2026-10-24T19:00:00Z') })).toBe('2026-10-25T09:00:00.000Z');
    });

    it('20:00 local do dia da mudança é 19:00 UTC', () => {
      expect(
        next({ timezone, now: at('2026-10-24T19:00:00Z'), taken: [at('2026-10-25T09:00:00Z')] }),
      ).toBe('2026-10-25T19:00:00.000Z');
    });

    it('carrossel às 14:00 no dia seguinte à mudança é 13:00 UTC', () => {
      expect(next({ timezone, format: 'carousel', now: at('2026-10-25T14:00:00Z') })).toBe(
        '2026-10-26T13:00:00.000Z',
      );
    });

    it('início do horário de verão (2027-03-28): 10:00 local passa a ser 08:00 UTC', () => {
      expect(next({ timezone, now: at('2027-03-27T20:00:00Z') })).toBe('2027-03-28T08:00:00.000Z');
    });
  });

  describe('America/Mexico_City (sem horário de verão, UTC-6)', () => {
    const timezone = 'America/Mexico_City';

    it('escolhe o próximo reel do dia', () => {
      // 06:00 local.
      expect(next({ timezone, now: at('2026-10-15T12:00:00Z') })).toBe('2026-10-15T16:00:00.000Z');
    });

    it('usa só horários do mesmo formato', () => {
      expect(next({ timezone, format: 'carousel', now: at('2026-10-15T12:00:00Z') })).toBe(
        '2026-10-15T20:00:00.000Z',
      );
    });

    it('mantém o mesmo deslocamento quando a Europa e os EUA mudam de horário', () => {
      expect(next({ timezone, now: at('2026-11-02T12:00:00Z') })).toBe('2026-11-02T16:00:00.000Z');
    });

    it('horários de hoje já passaram → amanhã', () => {
      // 21:00 local do dia 15.
      expect(next({ timezone, now: at('2026-10-16T03:00:00Z') })).toBe('2026-10-16T16:00:00.000Z');
    });

    it('vira o mês corretamente', () => {
      // 21:00 local de 31/10.
      expect(next({ timezone, now: at('2026-11-01T03:00:00Z') })).toBe('2026-11-01T16:00:00.000Z');
    });

    describe('antecedência', () => {
      it('pula o slot que começa antes de agora + 15 min', () => {
        // 09:50 local: o reel das 10:00 está a 10 min.
        expect(next({ timezone, now: at('2026-10-15T15:50:00Z') })).toBe(
          '2026-10-16T02:00:00.000Z',
        );
      });

      it('aceita o slot exatamente em agora + 15 min', () => {
        expect(next({ timezone, now: at('2026-10-15T15:45:00Z') })).toBe(
          '2026-10-15T16:00:00.000Z',
        );
      });

      it('respeita leadMinutes informado', () => {
        expect(next({ timezone, now: at('2026-10-15T15:50:00Z'), leadMinutes: 5 })).toBe(
          '2026-10-15T16:00:00.000Z',
        );
      });
    });

    it('pula horários já ocupados no canal', () => {
      expect(
        next({
          timezone,
          now: at('2026-10-15T12:00:00Z'),
          taken: [at('2026-10-15T16:00:00Z'), at('2026-10-16T02:00:00Z')],
        }),
      ).toBe('2026-10-16T16:00:00.000Z');
    });

    it('compara instantes exatos: horário fora da grade não ocupa o slot', () => {
      expect(
        next({ timezone, now: at('2026-10-15T12:00:00Z'), taken: [at('2026-10-15T16:01:00Z')] }),
      ).toBe('2026-10-15T16:00:00.000Z');
    });

    it('sem horário do formato na grade → no_slot_available', () => {
      expect(
        errorCode(() =>
          SlotAllocator.nextSlot({
            format: 'carousel',
            postingPlan: [{ localTime: '10:00', format: 'reel' }],
            timezone,
            taken: [],
            now: at('2026-10-15T12:00:00Z'),
          }),
        ),
      ).toBe('no_slot_available');
    });

    it('grade lotada dentro do horizonte → no_slot_available', () => {
      const plan: PostingSlot[] = [{ localTime: '10:00', format: 'reel' }];
      const now = at('2026-10-15T12:00:00Z');
      const taken = [at('2026-10-15T16:00:00Z'), at('2026-10-16T16:00:00Z')];

      expect(
        errorCode(() =>
          SlotAllocator.nextSlot({
            format: 'reel',
            postingPlan: plan,
            timezone,
            taken,
            now,
            horizonDays: 2,
          }),
        ),
      ).toBe('no_slot_available');
      // Com um dia a mais de horizonte, a vaga do dia 17 aparece.
      expect(
        SlotAllocator.nextSlot({
          format: 'reel',
          postingPlan: plan,
          timezone,
          taken,
          now,
          horizonDays: 3,
        }),
      ).toEqual(at('2026-10-17T16:00:00Z'));
    });

    it('rejeita horário malformado na grade', () => {
      expect(
        errorCode(() =>
          next({
            timezone,
            now: at('2026-10-15T12:00:00Z'),
            postingPlan: [{ localTime: '9h', format: 'reel' }],
          }),
        ),
      ).toBe('invalid_posting_slot');
    });
  });
});
