import { FixedClock } from '@sbs/shared-kernel/testing';
import { describe, expect, it } from 'vitest';
import { InMemoryEditingStandardRepository } from '../../infrastructure';
import { UpdateEditingStandard } from './update-editing-standard';

describe('UpdateEditingStandard', () => {
  it('salva por cima do padrão inicial e depois por cima da versão salva', async () => {
    const repo = new InMemoryEditingStandardRepository();
    const update = new UpdateEditingStandard(repo, new FixedClock('2026-10-21T12:00:00.000Z'));

    await update.execute({ guidelines: { hook: 'Gancho em até 5 palavras.' } }, 'Ana');
    await update.execute({ style: { showCaptions: false } }, 'Bia');

    const saved = await repo.get();
    expect(saved.version).toBe(2);
    expect(saved.guidelines.hook).toBe('Gancho em até 5 palavras.');
    expect(saved.style.showCaptions).toBe(false);
    expect(saved.updatedBy).toBe('Bia');
  });
});
