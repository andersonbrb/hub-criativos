import { copyAssets, type ContentAssets } from './content-assets';
import {
  productionStepFromSnapshot,
  productionStepToSnapshot,
  type ProductionStep,
  type ProductionStepSnapshot,
} from './production-step';

/** Pedido de ajustes do revisor que deu origem a uma revisão. */
export interface ChangeRequest {
  readonly by: string;
  readonly suggestion: string;
  readonly at: Date;
}

/** Resumo do relatório da governança para a revisão. O relatório completo mora lá. */
export interface AutomatedReview {
  readonly reportId: string;
  readonly score: number;
  readonly hasBlockingIssues: boolean;
}

/** Uma versão da peça. Imutável: o agregado troca a revisão atual por uma cópia alterada. */
export interface Revision {
  readonly number: number;
  readonly createdAt: Date;
  readonly caption: string;
  readonly hashtags: readonly string[];
  readonly assets: ContentAssets | null;
  readonly requestedChanges: ChangeRequest | null;
  readonly automatedReview: AutomatedReview | null;
  /** Registro das etapas de produção desta revisão (especialistas e revisores). */
  readonly production: readonly ProductionStep[];
}

export interface ChangeRequestSnapshot {
  by: string;
  suggestion: string;
  at: string;
}

export interface RevisionSnapshot {
  number: number;
  createdAt: string;
  caption: string;
  hashtags: string[];
  assets: ContentAssets | null;
  requestedChanges: ChangeRequestSnapshot | null;
  automatedReview: AutomatedReview | null;
  /** Ausente em revisões gravadas antes do registro de produção. */
  production?: ProductionStepSnapshot[];
}

export function firstRevision(now: Date): Revision {
  return {
    number: 1,
    createdAt: now,
    caption: '',
    hashtags: [],
    assets: null,
    requestedChanges: null,
    automatedReview: null,
    production: [],
  };
}

/** `oracion`, `#Oracion ` → `#oracion`/`#Oracion`; remove vazias e repetidas (sem diferenciar maiúsculas). */
export function normalizeHashtags(hashtags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of hashtags) {
    const body = raw.trim().replace(/^#+/, '');
    if (!body) continue;
    const key = body.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(`#${body}`);
  }
  return result;
}

export function changeRequestToSnapshot(request: ChangeRequest): ChangeRequestSnapshot {
  return { by: request.by, suggestion: request.suggestion, at: request.at.toISOString() };
}

export function changeRequestFromSnapshot(s: ChangeRequestSnapshot): ChangeRequest {
  return { by: s.by, suggestion: s.suggestion, at: new Date(s.at) };
}

export function revisionToSnapshot(r: Revision): RevisionSnapshot {
  return {
    number: r.number,
    createdAt: r.createdAt.toISOString(),
    caption: r.caption,
    hashtags: [...r.hashtags],
    assets: r.assets ? copyAssets(r.assets) : null,
    requestedChanges: r.requestedChanges ? changeRequestToSnapshot(r.requestedChanges) : null,
    automatedReview: r.automatedReview ? { ...r.automatedReview } : null,
    production: r.production.map(productionStepToSnapshot),
  };
}

export function revisionFromSnapshot(s: RevisionSnapshot): Revision {
  return {
    number: s.number,
    createdAt: new Date(s.createdAt),
    caption: s.caption,
    hashtags: [...s.hashtags],
    assets: s.assets ? copyAssets(s.assets) : null,
    requestedChanges: s.requestedChanges ? changeRequestFromSnapshot(s.requestedChanges) : null,
    automatedReview: s.automatedReview ? { ...s.automatedReview } : null,
    production: (s.production ?? []).map(productionStepFromSnapshot),
  };
}
