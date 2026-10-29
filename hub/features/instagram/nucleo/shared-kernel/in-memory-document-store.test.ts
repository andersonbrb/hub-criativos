import { describe, expect, it } from 'vitest';
import { ConcurrencyError } from './domain-error';
import { InMemoryDocumentStore } from './in-memory-document-store';

describe('InMemoryDocumentStore', () => {
  it('incrementa a versão a cada gravação', () => {
    const store = new InMemoryDocumentStore<{ id: string; version: number; n: number }>('Doc');
    expect(store.put({ id: 'a', version: 0, n: 1 })).toBe(1);
    expect(store.put({ id: 'a', version: 1, n: 2 })).toBe(2);
    expect(store.get('a')).toEqual({ id: 'a', version: 2, n: 2 });
  });

  it('recusa gravar a partir de uma versão desatualizada', () => {
    const store = new InMemoryDocumentStore<{ id: string; version: number }>('Doc');
    store.put({ id: 'a', version: 0 });
    expect(() => store.put({ id: 'a', version: 0 })).toThrow(ConcurrencyError);
  });

  it('devolve cópias, não referências', () => {
    const store = new InMemoryDocumentStore<{ id: string; version: number; tags: string[] }>('Doc');
    store.put({ id: 'a', version: 0, tags: [] });
    store.get('a')!.tags.push('x');
    expect(store.get('a')!.tags).toEqual([]);
  });
});
