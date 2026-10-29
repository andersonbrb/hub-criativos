'use client';

import type { Revision, StatusChange } from '@sbs/contracts';
import { MessageSquareText } from 'lucide-react';
import { StatusBadge } from '@/features/instagram/tela/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { MediaThumb } from '@/features/instagram/tela/ui/media';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/features/instagram/tela/ui/tabs';
import { cn } from '@/features/instagram/tela/lib/cn';
import { formatDateTime, formatScore } from '@/features/instagram/tela/lib/format';
import { contentStatus, toneClasses } from '@/features/instagram/tela/lib/status';
import { CaptionText } from './caption-editor';

function RevisionAssets({ revision }: { revision: Revision }) {
  const assets = revision.assets;
  if (!assets) return <p className="text-sm text-ink-subtle">Sem mídia nesta revisão.</p>;
  const thumbs = assets.format === 'reel' ? [assets.coverUrl ?? assets.videoUrl] : assets.slideUrls;
  return (
    <div className="flex flex-wrap gap-2">
      {thumbs.map((src, index) => (
        <MediaThumb
          key={`${src}-${index}`}
          src={src}
          alt={assets.format === 'reel' ? 'Capa do reel' : `Slide ${index + 1}`}
          format={index === 0 ? assets.format : undefined}
          className="w-16"
        />
      ))}
      {assets.format === 'reel' ? (
        <a
          href={assets.videoUrl}
          target="_blank"
          rel="noreferrer"
          className="self-end text-xs text-primary underline-offset-4 hover:underline"
        >
          Abrir vídeo
        </a>
      ) : null}
    </div>
  );
}

function RevisionDetails({ revision }: { revision: Revision }) {
  return (
    <div className="space-y-5">
      {revision.requestedChanges ? (
        <div className="rounded-lg border border-warning/35 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          <p className="flex items-center gap-2 font-semibold">
            <MessageSquareText className="size-4" aria-hidden />
            Sugestão que originou esta revisão
          </p>
          <p className="mt-1 leading-relaxed whitespace-pre-line">
            {revision.requestedChanges.suggestion}
          </p>
          <p className="mt-1.5 text-xs opacity-80">
            {revision.requestedChanges.by}, {formatDateTime(revision.requestedChanges.at)}
          </p>
        </div>
      ) : null}
      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-2">
          <h3 className="text-xs font-medium text-ink-subtle">Legenda</h3>
          <CaptionText caption={revision.caption} hashtags={revision.hashtags} />
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-ink-subtle">Mídia</h3>
          <RevisionAssets revision={revision} />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-ink-subtle">Revisão automática</h3>
        {revision.aiReview ? (
          <ul className="space-y-1 text-sm">
            <li className="text-ink">
              Nota <strong className="tabular-nums">{formatScore(revision.aiReview.score)}</strong>
              {revision.aiReview.hasBlockingIssues ? (
                <span className="ml-2 text-danger">com bloqueios</span>
              ) : null}
            </li>
            {revision.aiReview.checks
              .filter((check) => check.status !== 'pass')
              .map((check) => (
                <li key={check.code} className="text-ink-muted">
                  <span
                    className={cn(
                      'font-medium',
                      check.status === 'fail' ? 'text-danger' : 'text-warning',
                    )}
                  >
                    {check.label}:
                  </span>{' '}
                  {check.message}
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-subtle">Não houve revisão automática.</p>
        )}
      </div>
    </div>
  );
}

export function RevisionsTabs({
  revisions,
  currentNumber,
}: {
  revisions: readonly Revision[];
  currentNumber: number;
}) {
  const ordered = [...revisions].sort((a, b) => b.number - a.number);
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>Revisões</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <Tabs defaultValue={String(currentNumber)}>
          <TabsList aria-label="Revisões da peça">
            {ordered.map((revision) => (
              <TabsTrigger key={revision.number} value={String(revision.number)}>
                Revisão {revision.number}
                {revision.number === currentNumber ? (
                  <span className="rounded-full bg-primary-soft px-1.5 text-[0.6875rem] text-primary">
                    atual
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          {ordered.map((revision) => (
            <TabsContent key={revision.number} value={String(revision.number)}>
              <p className="mb-4 text-xs text-ink-subtle">
                Criada em {formatDateTime(revision.createdAt)}
              </p>
              <RevisionDetails revision={revision} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

export function HistoryTimeline({ history }: { history: readonly StatusChange[] }) {
  const ordered = [...history].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Histórico</CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-sm text-ink-subtle">Nenhuma mudança registrada.</p>
        ) : (
          <ol className="relative space-y-5 border-l border-border pl-5">
            {ordered.map((change, index) => {
              const meta = contentStatus(change.to);
              return (
                <li key={`${change.at}-${index}`} className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-surface',
                      toneClasses[meta.tone].dot,
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge meta={meta} />
                    <time dateTime={change.at} className="text-xs text-ink-subtle">
                      {formatDateTime(change.at)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {change.by ? (
                      <span className="font-medium text-ink">{change.by}</span>
                    ) : (
                      'Sistema'
                    )}
                  </p>
                  {change.note ? (
                    <p className="mt-1 rounded-md bg-surface-sunken px-3 py-2 text-sm leading-relaxed whitespace-pre-line text-ink">
                      {change.note}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
