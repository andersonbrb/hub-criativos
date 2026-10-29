import { ChannelId, DomainError, MarketId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Channel } from './channel';
import { PostingPlan } from './posting-plan';

const now = new Date('2026-10-15T12:00:00Z');
const create = (overrides: Partial<Parameters<typeof Channel.create>[1]> = {}) =>
  Channel.create(
    ChannelId('c-1'),
    {
      marketId: MarketId('m-1'),
      handle: '@MomentoDeOracionSB',
      displayName: 'Momento de Oración',
      ...overrides,
    },
    now,
  );

describe('Channel', () => {
  it('normaliza o @ e as maiúsculas do usuário e começa desconectado', () => {
    const channel = create();
    expect(channel.handle).toBe('momentodeoracionsb');
    expect(channel.connectionStatus).toBe('disconnected');
  });

  it('usa a grade padrão: 2 reels e 1 carrossel', () => {
    const plan = create().postingPlan;
    expect(plan.countOf('reel')).toBe(2);
    expect(plan.countOf('carousel')).toBe(1);
  });

  it('rejeita usuário inválido', () => {
    expect(() => create({ handle: 'nome com espaço' })).toThrow(DomainError);
  });

  it('conecta guardando o id externo da conta', () => {
    const channel = create();
    channel.connect('17841400000000000');
    expect(channel.connectionStatus).toBe('connected');
    expect(channel.externalAccountId).toBe('17841400000000000');
  });

  it('sobrevive a ida e volta pelo snapshot', () => {
    const channel = create();
    expect(Channel.fromSnapshot(channel.toSnapshot()).toSnapshot()).toEqual(channel.toSnapshot());
  });
});

describe('PostingPlan', () => {
  it('ordena os horários', () => {
    const plan = PostingPlan.of([
      { localTime: '20:00', format: 'reel' },
      { localTime: '09:30', format: 'carousel' },
    ]);
    expect(plan.slots.map((s) => s.localTime)).toEqual(['09:30', '20:00']);
  });

  it.each([
    ['vazia', []],
    ['horário inválido', [{ localTime: '25:00', format: 'reel' as const }]],
    [
      'horário repetido',
      [
        { localTime: '10:00', format: 'reel' as const },
        { localTime: '10:00', format: 'carousel' as const },
      ],
    ],
  ])('rejeita grade %s', (_label, slots) => {
    expect(() => PostingPlan.of(slots)).toThrow(DomainError);
  });
});
