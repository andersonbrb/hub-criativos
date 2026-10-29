import { and, eq, sql } from 'drizzle-orm';

import { instagramDocumentos, instagramEventos } from '@/db/schema';
import { organizacaoAtual } from '@/features/acesso/servicos/organizacao-atual';

import type { Database } from '../infrastructure/database/postgres-document-store';

/**
 * Importação dos dados do projeto de origem (o "San Benito Social" no Railway, migrado em 29/10/2026) para a
 * organização em que o código está rodando: os documentos com o mesmo id, a mesma versão e as mesmas datas, e o
 * histórico de eventos. Rodar de novo não duplica nem sobrescreve (o que já existe fica como está). As credenciais
 * (platform.integration) não entram aqui: as chaves vão para a tela Integrações do hub e os tokens das contas do
 * Instagram só valem com um login novo pelo endereço do hub.
 */
export const IMPORTABLE_TYPES = [
  'markets.market',
  'markets.channel',
  'reference.source',
  'reference.post',
  'studio.content_piece',
  'studio.editing_standard',
  'governance.review_report',
  'publishing.publication',
] as const;

export interface ImportInput {
  documents: {
    type: string;
    id: string;
    version: number;
    data: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }[];
  events: { type: string; occurredAt: string; payload: unknown }[];
}

export interface ImportResult {
  documents: number;
  skippedDocuments: number;
  events: number;
}

export async function importData(db: Database, input: ImportInput): Promise<ImportResult> {
  const org = await organizacaoAtual();
  const allowed = new Set<string>(IMPORTABLE_TYPES);
  return db.transaction(async (tx) => {
    let documents = 0;
    let skippedDocuments = 0;
    for (const doc of input.documents) {
      if (!allowed.has(doc.type)) {
        skippedDocuments++;
        continue;
      }
      const inserted = await tx
        .insert(instagramDocumentos)
        .values({
          organizacaoId: org,
          tipo: doc.type,
          id: doc.id,
          versao: doc.version,
          dados: { ...doc.data, version: doc.version },
          criadoEm: new Date(doc.createdAt),
          atualizadoEm: new Date(doc.updatedAt),
        })
        .onConflictDoNothing()
        .returning({ id: instagramDocumentos.id });
      if (inserted.length) documents++;
      else skippedDocuments++;
    }
    // O histórico entra uma vez só: se a organização já tem eventos, a importação já aconteceu (ou ela já usou).
    const [existing] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(instagramEventos)
      .where(and(eq(instagramEventos.organizacaoId, org)));
    let events = 0;
    if ((existing?.total ?? 0) === 0 && input.events.length) {
      await tx.insert(instagramEventos).values(
        input.events.map((e) => ({ organizacaoId: org, tipo: e.type, ocorreuEm: new Date(e.occurredAt), dados: e.payload ?? {} })),
      );
      events = input.events.length;
    }
    return { documents, skippedDocuments, events };
  });
}
