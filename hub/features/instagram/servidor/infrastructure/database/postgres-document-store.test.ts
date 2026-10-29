import { ConcurrencyError } from '@sbs/shared-kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import { organizacoes } from '@/db/schema';
import { bancoDeTeste } from '@/db/teste';
import { comOrganizacao } from '@/features/acesso/servicos/organizacao-atual';

import type { Database } from './postgres-document-store';
import { PostgresDocumentStore } from './postgres-document-store';

interface Doc {
  id: string;
  version: number;
  status: string;
  marketId: string;
}

describe('PostgresDocumentStore (PGlite)', () => {
  let db: Database;
  let store: PostgresDocumentStore<Doc>;

  // Subir o PGlite e aplicar as migrações passa dos 10 s padrão com a máquina ocupada.
  beforeAll(async () => {
    db = await bancoDeTeste();
    store = new PostgresDocumentStore<Doc>(() => db, 'test.doc', 'Doc');
  }, 60_000);


  it('insere e incrementa a versão a cada gravação', async () => {
    expect(await store.put({ id: 'a', version: 0, status: 'new', marketId: 'm1' })).toBe(1);
    expect(await store.put({ id: 'a', version: 1, status: 'done', marketId: 'm1' })).toBe(2);
    expect(await store.get('a')).toEqual({ id: 'a', version: 2, status: 'done', marketId: 'm1' });
  });

  it('recusa versão desatualizada e id duplicado', async () => {
    await store.put({ id: 'b', version: 0, status: 'new', marketId: 'm1' });
    await expect(
      store.put({ id: 'b', version: 0, status: 'x', marketId: 'm1' }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(
      store.put({ id: 'b', version: 5, status: 'x', marketId: 'm1' }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('filtra por igualdade de campos do snapshot', async () => {
    await store.put({ id: 'c', version: 0, status: 'new', marketId: 'm2' });
    const found = await store.find({ status: 'new' });
    expect(found.map((d) => d.id).sort()).toEqual(['b', 'c']);
    expect((await store.find({ status: 'new', marketId: 'm2' })).map((d) => d.id)).toEqual(['c']);
  });

  it('isola documentos por tipo', async () => {
    const other = new PostgresDocumentStore<Doc>(() => db, 'test.other', 'Other');
    expect(await other.get('a')).toBeNull();
  });

  it('isola documentos por organização: outra organização não vê nem sobrescreve', async () => {
    const outra = 'a6b2b8a0-1111-4c3e-9d9e-000000000001';
    await db.insert(organizacoes).values({ id: outra, nome: 'Outra' });
    await comOrganizacao(outra, async () => {
      expect(await store.get('a')).toBeNull();
      expect(await store.find({})).toEqual([]);
      expect(await store.put({ id: 'a', version: 0, status: 'dela', marketId: 'm9' })).toBe(1);
    });
    expect((await store.get('a'))?.status).toBe('done');
  });
});
