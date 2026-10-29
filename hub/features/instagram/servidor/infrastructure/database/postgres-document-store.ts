import { ConcurrencyError } from '@sbs/shared-kernel';
import { and, asc, eq, sql } from 'drizzle-orm';

import { banco, type Banco } from '@/db/cliente';
import { instagramDocumentos } from '@/db/schema';
import { organizacaoAtual } from '@/features/acesso/servicos/organizacao-atual';

/** O banco do hub (Postgres no Railway, PGlite nos testes). */
export type Database = Banco;

/** Banco do processo, lido a cada uso: os testes trocam o banco a cada caso (db/teste.ts). */
export const currentDatabase = (): Database => banco();

interface Versioned {
  id: string;
  version: number;
}

/**
 * Equivalente persistente do `InMemoryDocumentStore` do shared-kernel: mesmos snapshots, mesma regra de versão
 * (grava `version + 1`, recusa versão desatualizada). Cada documento é da organização em que o código está rodando
 * (organizacaoAtual): uma organização nunca lê nem grava o documento de outra.
 */
export class PostgresDocumentStore<TSnapshot extends Versioned> {
  constructor(
    private readonly db: () => Database,
    private readonly type: string,
    private readonly entity: string,
  ) {}

  async get(id: string): Promise<TSnapshot | null> {
    const org = await organizacaoAtual();
    const [row] = await this.db()
      .select({ data: instagramDocumentos.dados, version: instagramDocumentos.versao })
      .from(instagramDocumentos)
      .where(and(eq(instagramDocumentos.organizacaoId, org), eq(instagramDocumentos.tipo, this.type), eq(instagramDocumentos.id, id)));
    return row ? this.toSnapshot(row) : null;
  }

  /** Documentos cujo snapshot contém `match` (igualdade de campos, via índice GIN). */
  async find(match: Partial<Record<keyof TSnapshot & string, unknown>> = {}): Promise<TSnapshot[]> {
    const org = await organizacaoAtual();
    const rows = await this.db()
      .select({ data: instagramDocumentos.dados, version: instagramDocumentos.versao })
      .from(instagramDocumentos)
      .where(
        and(
          eq(instagramDocumentos.organizacaoId, org),
          eq(instagramDocumentos.tipo, this.type),
          sql`${instagramDocumentos.dados} @> ${JSON.stringify(match)}::jsonb`,
        ),
      )
      .orderBy(asc(instagramDocumentos.criadoEm), asc(instagramDocumentos.id));
    return rows.map((r) => this.toSnapshot(r));
  }

  async put(snapshot: TSnapshot): Promise<number> {
    const org = await organizacaoAtual();
    const next = snapshot.version + 1;
    const data = { ...snapshot, version: next } as unknown as Record<string, unknown>;

    if (snapshot.version === 0) {
      const inserted = await this.db()
        .insert(instagramDocumentos)
        .values({ organizacaoId: org, tipo: this.type, id: snapshot.id, versao: next, dados: data })
        .onConflictDoNothing()
        .returning({ id: instagramDocumentos.id });
      if (inserted.length === 0) throw new ConcurrencyError(this.entity, snapshot.id);
      return next;
    }

    const updated = await this.db()
      .update(instagramDocumentos)
      .set({ versao: next, dados: data, atualizadoEm: new Date() })
      .where(
        and(
          eq(instagramDocumentos.organizacaoId, org),
          eq(instagramDocumentos.tipo, this.type),
          eq(instagramDocumentos.id, snapshot.id),
          eq(instagramDocumentos.versao, snapshot.version),
        ),
      )
      .returning({ id: instagramDocumentos.id });
    if (updated.length === 0) throw new ConcurrencyError(this.entity, snapshot.id);
    return next;
  }

  /** Remove o documento (usado só por configurações, não por agregados de domínio). */
  async delete(id: string): Promise<void> {
    const org = await organizacaoAtual();
    await this.db()
      .delete(instagramDocumentos)
      .where(and(eq(instagramDocumentos.organizacaoId, org), eq(instagramDocumentos.tipo, this.type), eq(instagramDocumentos.id, id)));
  }

  private toSnapshot(row: { data: Record<string, unknown>; version: number }): TSnapshot {
    return { ...row.data, version: row.version } as unknown as TSnapshot;
  }
}
