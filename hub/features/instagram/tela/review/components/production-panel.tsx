'use client';

import type { ProductionStep, ProductionStepKind } from '@sbs/contracts';
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { StatusBadge } from '@/features/instagram/tela/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { productionStepStatusMeta } from '@/features/instagram/tela/lib/status';

export const PRODUCTION_STEP_LABEL: Record<ProductionStepKind, string> = {
  ingest: 'Armazenamento da mídia',
  subtitle_removal: 'Remoção de legendas',
  video_translation: 'Tradução do vídeo',
  audio: 'Áudio',
  images: 'Imagens',
  editing: 'Edição',
  caption: 'Legenda',
  creative: 'Criativos',
};

function fileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url;
  }
}

function StepItem({ step }: { step: ProductionStep }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-ink">{PRODUCTION_STEP_LABEL[step.kind]}</p>
        <StatusBadge meta={productionStepStatusMeta[step.status]} />
        {step.attempts.length > 1 ? (
          <span className="text-xs text-ink-muted">{step.attempts.length} tentativas</span>
        ) : null}
      </div>
      {step.note ? <p className="mt-1 text-xs text-ink-muted">{step.note}</p> : null}
      {step.attempts.length > 0 ? (
        <ol className="mt-2 space-y-2">
          {step.attempts.map((attempt) => (
            <li key={attempt.number} className="border-l-2 border-border pl-3 text-xs">
              <p className="whitespace-pre-line text-ink">
                <span className="text-ink-subtle">Tentativa {attempt.number} · </span>
                {attempt.error ? (
                  <span className="text-danger">Erro: {attempt.error}</span>
                ) : (
                  (attempt.summary ?? 'Em andamento…')
                )}
              </p>
              {attempt.review ? (
                <p
                  className={
                    attempt.review.approved
                      ? 'mt-0.5 flex items-start gap-1 text-success-ink'
                      : 'mt-0.5 flex items-start gap-1 text-danger'
                  }
                >
                  {attempt.review.approved ? (
                    <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                  )}
                  <span>
                    <span className="sr-only">
                      {attempt.review.approved
                        ? 'Aprovado pelo revisor:'
                        : 'Devolvido pelo revisor:'}
                    </span>
                    {attempt.review.notes}
                  </span>
                </p>
              ) : null}
              {attempt.outputUrls.length > 0 ? (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {attempt.outputUrls.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                      >
                        {fileName(url)}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/** Etapas da produção desta revisão: o que cada agente fez e o parecer de cada revisor. */
export function ProductionPanel({ steps }: { steps: ProductionStep[] }) {
  return (
    <Card role="region" aria-labelledby="production-title">
      <CardHeader>
        <div>
          <CardTitle id="production-title">Produção</CardTitle>
          <CardDescription>
            Cada etapa passa por um agente especialista e pelo revisor dela (até 3 tentativas).
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Esta revisão foi produzida antes do registro de etapas.
          </p>
        ) : (
          <ol className="grid gap-2 md:grid-cols-2">
            {steps.map((step) => (
              <StepItem key={step.kind} step={step} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
