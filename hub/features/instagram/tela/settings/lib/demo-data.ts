import type { DemoDataSummary } from '@sbs/contracts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function hasDemoData(summary: DemoDataSummary): boolean {
  return (
    summary.posts + summary.adaptations + summary.reviews + summary.publications + summary.events >
    0
  );
}

/** "12 posts de exemplo, 20 adaptações e 20 revisões" — só o que existe. */
export function describeDemoData(summary: DemoDataSummary): string {
  const parts = [
    summary.posts > 0 ? plural(summary.posts, 'post de exemplo', 'posts de exemplo') : null,
    summary.adaptations > 0 ? plural(summary.adaptations, 'adaptação', 'adaptações') : null,
    summary.reviews > 0 ? plural(summary.reviews, 'revisão', 'revisões') : null,
    summary.publications > 0 ? plural(summary.publications, 'agendamento', 'agendamentos') : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return 'só registros de histórico';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}
