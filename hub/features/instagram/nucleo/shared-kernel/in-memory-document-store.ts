import { ConcurrencyError } from './domain-error';

interface Versioned {
  id: string;
  version: number;
}

/**
 * Armazena snapshots de agregados em memória com concorrência otimista.
 * Base dos repositórios em memória de todos os contextos (dev e testes).
 *
 * A versão gravada é sempre `snapshot.version + 1`; gravar a partir de uma versão
 * desatualizada lança `ConcurrencyError`, igual ao repositório Postgres.
 */
export class InMemoryDocumentStore<TSnapshot extends Versioned> {
  private readonly docs = new Map<string, TSnapshot>();

  constructor(private readonly entity: string) {}

  get(id: string): TSnapshot | null {
    const doc = this.docs.get(id);
    return doc ? structuredClone(doc) : null;
  }

  all(): TSnapshot[] {
    return [...this.docs.values()].map((d) => structuredClone(d));
  }

  find(predicate: (doc: TSnapshot) => boolean): TSnapshot[] {
    return this.all().filter(predicate);
  }

  /** Grava e devolve a nova versão. */
  put(snapshot: TSnapshot): number {
    const current = this.docs.get(snapshot.id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== snapshot.version) throw new ConcurrencyError(this.entity, snapshot.id);
    const next = snapshot.version + 1;
    this.docs.set(snapshot.id, structuredClone({ ...snapshot, version: next }));
    return next;
  }
}
