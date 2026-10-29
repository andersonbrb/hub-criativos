import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from './adapters';
import { domainEvent } from './domain-event';

describe('InMemoryEventBus', () => {
  it('entrega cada evento aos assinantes do seu tipo, em ordem', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    bus.subscribe('A', async (e) => void received.push(`a1:${String(e.payload)}`));
    bus.subscribe('A', async (e) => void received.push(`a2:${String(e.payload)}`));
    bus.subscribe('B', async () => void received.push('b'));

    const at = new Date('2026-10-15T00:00:00Z');
    await bus.publish([domainEvent('A', at, 1), domainEvent('C', at, 2)]);

    expect(received).toEqual(['a1:1', 'a2:1']);
  });
});
