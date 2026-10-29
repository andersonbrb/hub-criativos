import type { ContentPieceStatus } from './content-piece-status';

/** Uma linha do histórico da peça. `from === to` registra ações sem troca de status (ex.: edição). */
export interface StatusChange {
  readonly from: ContentPieceStatus | null;
  readonly to: ContentPieceStatus;
  readonly at: Date;
  readonly by: string | null;
  readonly note: string | null;
}

export interface StatusChangeSnapshot {
  from: ContentPieceStatus | null;
  to: ContentPieceStatus;
  at: string;
  by: string | null;
  note: string | null;
}

export function statusChangeToSnapshot(c: StatusChange): StatusChangeSnapshot {
  return { from: c.from, to: c.to, at: c.at.toISOString(), by: c.by, note: c.note };
}

export function statusChangeFromSnapshot(s: StatusChangeSnapshot): StatusChange {
  return { from: s.from, to: s.to, at: new Date(s.at), by: s.by, note: s.note };
}
