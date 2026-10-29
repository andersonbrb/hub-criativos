'use client';

import type { ContentPiece, DecisionInput, Market } from '@sbs/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge, Tag } from '@/features/instagram/tela/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { ErrorState, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { MarketChip } from '@/features/instagram/tela/ui/media';
import { useChannelIndex, useMarketIndex } from '@/features/instagram/tela/markets/hooks/use-markets';
import { errorMessage, isApiError } from '@/features/instagram/tela/lib/api/errors';
import { formatScore } from '@/features/instagram/tela/lib/format';
import { contentStatus, formatLabel, isAwaitingDecision } from '@/features/instagram/tela/lib/status';
import { fetchNextAwaiting, useContentPiece, useDecision } from '../hooks/use-content-piece';
import { useReviewShortcuts } from '../hooks/use-review-shortcuts';
import { approvalBlocker, blockingChecks } from '../lib/review-rules';
import { ActionBar } from './action-bar';
import { AiReviewPanel } from './ai-review-panel';
import { ProductionPanel } from './production-panel';
import { CaptionEditor, CaptionText } from './caption-editor';
import { RejectDialog, RequestChangesDialog } from './decision-dialogs';
import { MediaViewer, sourceMedia, type MediaSource } from './media-viewer';
import { HistoryTimeline, RevisionsTabs } from './revision-history';
import { StatusBanner } from './status-banner';

type DialogKind = 'request_changes' | 'reject' | null;

const successCopy: Record<DecisionInput['action'], { title: string; description: string }> = {
  approve: {
    title: 'Aprovada',
    description: 'A publicação será agendada no próximo horário livre do canal.',
  },
  request_changes: {
    title: 'Voltou para a edição',
    description: 'Uma nova versão será editada com o seu motivo.',
  },
  reject: { title: 'Reprovada', description: 'Esta adaptação não será publicada.' },
};

function adaptationMedia(piece: ContentPiece): MediaSource {
  const assets = piece.currentRevision.assets;
  if (assets?.format === 'reel') {
    return { format: 'reel', videoUrl: assets.videoUrl, posterUrl: assets.coverUrl };
  }
  if (assets?.format === 'carousel') return { format: 'carousel', slideUrls: assets.slideUrls };
  return piece.format === 'reel'
    ? { format: 'reel', videoUrl: null, posterUrl: null }
    : { format: 'carousel', slideUrls: [] };
}

function ReviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Carregando peça">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-9 w-80" />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr_minmax(18rem,0.85fr)]">
        <Skeleton className="h-[32rem] rounded-xl" />
        <Skeleton className="h-[32rem] rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

export function ReviewView({ id }: { id: string }) {
  const query = useContentPiece(id);
  const markets = useMarketIndex();

  if (query.isPending) return <ReviewSkeleton />;
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.status === 404;
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <BackLink />
        <ErrorState
          error={query.error}
          title={notFound ? 'Peça não encontrada' : 'Não foi possível carregar a peça'}
          onRetry={notFound ? undefined : () => void query.refetch()}
        />
      </div>
    );
  }
  return <ReviewContent piece={query.data} market={markets.get(query.data.marketId)} />;
}

function BackLink() {
  return (
    <Link
      href="/instagram/producao"
      className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Produção
    </Link>
  );
}

function ReviewContent({ piece, market }: { piece: ContentPiece; market: Market | undefined }) {
  const router = useRouter();
  const client = useQueryClient();
  const channels = useChannelIndex();
  const decision = useDecision(piece.id);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [pendingAction, setPendingAction] = useState<DecisionInput['action'] | null>(null);

  const revision = piece.currentRevision;
  const awaiting = isAwaitingDecision(piece.status);
  const blocker = approvalBlocker(piece);
  const blocking = blockingChecks(revision);
  const channel = channels.get(piece.channelId);
  const marketName = market?.name ?? 'mercado';

  function decide(input: DecisionInput) {
    setPendingAction(input.action);
    decision.mutate(input, {
      onSuccess: async () => {
        setDialog(null);
        const copy = successCopy[input.action];
        // Falhar ao buscar a próxima peça não desfaz a decisão: só fica na página.
        const nextId = await fetchNextAwaiting(client, piece.id).catch(() => null);
        toast.success(copy.title, {
          description: nextId
            ? `${copy.description} Abrindo a próxima peça da fila.`
            : `${copy.description} Não há mais peças aguardando aprovação.`,
        });
        setPendingAction(null);
        if (nextId) router.push(`/instagram/conteudos/${nextId}`);
      },
      onError: (error) => {
        setPendingAction(null);
        if (input.action === 'approve') {
          toast.error('Não foi possível aprovar', { description: errorMessage(error) });
        }
      },
    });
  }

  function openDialog(kind: Exclude<DialogKind, null>) {
    decision.reset();
    setDialog(kind);
  }

  useReviewShortcuts(awaiting && dialog === null && pendingAction === null, {
    onApprove: () => {
      if (blocker) {
        toast.warning('Aprovação indisponível', { description: blocker });
        return;
      }
      decide({ action: 'approve' });
    },
    onRequestChanges: () => openDialog('request_changes'),
    onReject: () => openDialog('reject'),
  });

  const status = contentStatus(piece.status);

  return (
    <div className={awaiting ? '' : 'pb-4'}>
      <div className="mb-5 space-y-3">
        <BackLink />
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h1 className="font-display text-[1.75rem] leading-tight font-semibold text-ink">
              {formatLabel(piece.format)} para {marketName}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <MarketChip market={market} fallbackId={piece.marketId} size="sm" />
              {channel ? <Tag>@{channel.handle}</Tag> : null}
              <Tag>Revisão {revision.number}</Tag>
            </div>
          </div>
          <StatusBadge meta={status} className="self-start px-3 py-1 text-sm md:self-auto" />
        </div>
      </div>

      <div className="mb-5 empty:hidden">
        <StatusBanner piece={piece} market={market} />
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-[1fr_1fr_minmax(18rem,0.85fr)]">
        <Card role="region" aria-labelledby="original-title">
          <CardHeader>
            <div>
              <CardTitle id="original-title">Original (BR)</CardTitle>
              <p className="text-xs text-ink-muted">Post de referência em português</p>
            </div>
            <a
              href={piece.source.permalink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Ver post
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </CardHeader>
          <CardContent className="space-y-5">
            <MediaViewer
              media={sourceMedia(piece.format, piece.source.mediaUrls, piece.source.thumbnailUrl)}
              label="Mídia do post original"
            />
            <CaptionText caption={piece.source.caption} hashtags={[]} />
          </CardContent>
        </Card>

        <Card role="region" aria-labelledby="adaptation-title" className="border-primary/30">
          <CardHeader>
            <div>
              <CardTitle id="adaptation-title">Adaptação ({marketName})</CardTitle>
              <p className="text-xs text-ink-muted">
                {market
                  ? `Como vai ao ar em @${channel?.handle ?? market.code}`
                  : 'Versão do mercado'}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <MediaViewer
              media={adaptationMedia(piece)}
              label={`Mídia da adaptação para ${marketName}`}
            />
            {awaiting ? (
              <CaptionEditor
                key={`${revision.number}-${revision.caption}-${revision.hashtags.join(' ')}`}
                pieceId={piece.id}
                caption={revision.caption}
                hashtags={revision.hashtags}
              />
            ) : (
              <CaptionText caption={revision.caption} hashtags={revision.hashtags} />
            )}
          </CardContent>
        </Card>

        <div className="md:col-span-2 xl:sticky xl:top-20 xl:col-span-1">
          <AiReviewPanel review={revision.aiReview} />
        </div>
      </div>

      <div className="mt-5">
        <ProductionPanel steps={revision.production} />
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <RevisionsTabs revisions={piece.revisions} currentNumber={revision.number} />
        <HistoryTimeline history={piece.history} />
      </div>

      {awaiting ? (
        <>
          <ActionBar
            approveBlocker={blocker}
            pendingAction={pendingAction}
            onApprove={() => decide({ action: 'approve' })}
            onRequestChanges={() => openDialog('request_changes')}
            onReject={() => openDialog('reject')}
            summary={
              revision.aiReview ? (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    Nota automática{' '}
                    <strong className="text-ink tabular-nums">
                      {formatScore(revision.aiReview.score)}
                    </strong>
                  </span>
                  {blocking.length > 0 ? (
                    <span className="inline-flex items-center gap-1 font-medium text-danger">
                      <ShieldAlert className="size-4" aria-hidden />
                      {blocking.length === 1 ? '1 bloqueio' : `${blocking.length} bloqueios`}
                    </span>
                  ) : (
                    <span>Sem bloqueios</span>
                  )}
                </span>
              ) : (
                'Revisão automática pendente'
              )
            }
          />
          <RequestChangesDialog
            open={dialog === 'request_changes'}
            onOpenChange={(open) => setDialog(open ? 'request_changes' : null)}
            pending={pendingAction === 'request_changes'}
            error={pendingAction === null && dialog === 'request_changes' ? decision.error : null}
            onSubmit={(suggestion) => decide({ action: 'request_changes', suggestion })}
          />
          <RejectDialog
            open={dialog === 'reject'}
            onOpenChange={(open) => setDialog(open ? 'reject' : null)}
            pending={pendingAction === 'reject'}
            error={pendingAction === null && dialog === 'reject' ? decision.error : null}
            onSubmit={(reason) => decide({ action: 'reject', reason })}
          />
        </>
      ) : null}
    </div>
  );
}
