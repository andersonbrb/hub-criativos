import { CheckCircle2, CircleAlert, Hourglass, Pencil, ShieldAlert, XCircle } from 'lucide-react';
import type { AiReview, ReviewCheck } from '@sbs/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { cn } from '@/features/instagram/tela/lib/cn';
import { formatScore } from '@/features/instagram/tela/lib/format';
import { countChecks, sortChecks } from '../lib/review-rules';

function scoreTone(score: number): { bar: string; text: string; label: string } {
  if (score >= 85) return { bar: 'bg-success', text: 'text-success', label: 'Boa' };
  if (score >= 65) return { bar: 'bg-attention', text: 'text-attention', label: 'Atenção' };
  return { bar: 'bg-danger', text: 'text-danger', label: 'Fraca' };
}

const checkIcons = {
  pass: { icon: CheckCircle2, className: 'text-success', label: 'Aprovado' },
  warn: { icon: CircleAlert, className: 'text-warning', label: 'Aviso' },
  fail: { icon: XCircle, className: 'text-danger', label: 'Falhou' },
} as const;

function CheckRow({ check }: { check: ReviewCheck }) {
  const meta = checkIcons[check.status];
  const Icon = meta.icon;
  const isBlocking = check.blocking && check.status === 'fail';
  return (
    <li
      className={cn(
        'flex gap-3 rounded-lg px-3 py-2.5',
        isBlocking ? 'border border-danger/40 bg-danger-soft' : 'bg-transparent',
      )}
      data-blocking={isBlocking || undefined}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} aria-label={meta.label} />
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink">
          {check.label}
          {isBlocking ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger-ink">
              <ShieldAlert className="size-3.5" aria-hidden />
              Bloqueia a aprovação
            </span>
          ) : null}
        </p>
        {check.message ? (
          <p
            className={cn(
              'text-[0.8125rem] leading-relaxed',
              isBlocking ? 'text-danger-ink' : 'text-ink-muted',
            )}
          >
            {check.message}
          </p>
        ) : null}
      </div>
    </li>
  );
}

const GENERAL_REVIEW_CODE = 'general_review';

const GENERAL_TONE: Record<ReviewCheck['status'], { box: string; label: string }> = {
  pass: { box: 'border-success/40 bg-success-soft text-success-ink', label: 'Pronta para aprovar' },
  warn: {
    box: 'border-warning/40 bg-warning-soft text-warning-ink',
    label: 'Aprovar com ressalvas',
  },
  fail: { box: 'border-danger/40 bg-danger-soft text-danger-ink', label: 'Recomenda não aprovar' },
};

/** Parecer do revisor geral: olhou mídia final, legenda e o relatório de cada etapa. */
function GeneralReview({ check }: { check: ReviewCheck }) {
  const tone = GENERAL_TONE[check.status];
  return (
    <section
      aria-label="Revisor geral"
      className={cn('rounded-lg border px-3 py-2.5 text-[0.8125rem] leading-relaxed', tone.box)}
    >
      <p className="font-semibold">Revisor geral · {tone.label}</p>
      <p>{check.message}</p>
    </section>
  );
}

export function AiReviewPanel({ review }: { review: AiReview | null }) {
  if (!review) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Revisão automática</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg bg-surface-sunken px-4 py-5 text-sm text-ink-muted">
            <Hourglass className="size-4 shrink-0" aria-hidden />
            As checagens desta revisão ainda não terminaram.
          </div>
        </CardContent>
      </Card>
    );
  }

  const tone = scoreTone(review.score);
  const counts = countChecks(review.checks);
  // O parecer do revisor geral (a peça inteira) aparece em destaque, fora da lista.
  const general = review.checks.find((c) => c.code === GENERAL_REVIEW_CODE) ?? null;
  const checks = sortChecks(review.checks.filter((c) => c.code !== GENERAL_REVIEW_CODE));
  const blockingCount = review.checks.filter((c) => c.blocking && c.status === 'fail').length;

  return (
    <Card role="region" aria-labelledby="ai-review-title">
      <CardHeader className="pb-2">
        <CardTitle id="ai-review-title">Revisão automática</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {review.trigger === 'caption_edit' ? (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Pencil className="size-3.5 shrink-0" aria-hidden />
            Refeita sobre a legenda editada pelo revisor.
          </p>
        ) : null}
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-ink-muted">Nota</p>
            <p className="font-display text-4xl leading-none font-semibold tabular-nums text-ink">
              {formatScore(review.score)}
              <span className="ml-1 text-base font-normal text-ink-subtle">/100</span>
            </p>
          </div>
          <p className={cn('text-sm font-semibold', tone.text)}>{tone.label}</p>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
          role="meter"
          aria-label="Nota da revisão automática"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={review.score}
        >
          <div
            className={cn('h-full rounded-full', tone.bar)}
            style={{ width: `${review.score}%` }}
          />
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>
            <strong className="font-semibold text-success">{counts.pass}</strong> ok
          </span>
          <span>
            <strong className="font-semibold text-warning">{counts.warn}</strong>{' '}
            {counts.warn === 1 ? 'aviso' : 'avisos'}
          </span>
          <span>
            <strong className="font-semibold text-danger">{counts.fail}</strong>{' '}
            {counts.fail === 1 ? 'falha' : 'falhas'}
          </span>
        </p>

        {review.hasBlockingIssues ? (
          <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-[0.8125rem] leading-relaxed text-danger-ink">
            <p className="font-semibold">
              {blockingCount > 1
                ? `${blockingCount} problemas impedem a aprovação`
                : 'Um problema impede a aprovação'}
            </p>
            <p>
              Corrija a legenda aqui mesmo ou volte para a edição descrevendo a correção. A nova
              versão passa por esta revisão de novo.
            </p>
          </div>
        ) : null}

        {general ? <GeneralReview check={general} /> : null}

        <ul className="-mx-3 space-y-1" aria-label="Checagens">
          {checks.map((check) => (
            <CheckRow key={check.code} check={check} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
