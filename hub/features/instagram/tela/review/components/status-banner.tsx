'use client';

import type { ContentPiece, Market } from '@sbs/contracts';
import {
  CalendarClock,
  CircleCheckBig,
  ExternalLink,
  Loader2,
  MessageSquareText,
  OctagonX,
  RotateCw,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/features/instagram/tela/ui/button';
import { InlineAlert } from '@/features/instagram/tela/ui/feedback';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { formatDateTime, timeZoneLabel, viewerTimeZone } from '@/features/instagram/tela/lib/format';
import { publicationStatus } from '@/features/instagram/tela/lib/status';
import { useRetryContentPiece } from '../hooks/use-content-piece';

function lastNoteFor(piece: ContentPiece, status: ContentPiece['status']): string | null {
  const change = [...piece.history].reverse().find((entry) => entry.to === status);
  return change?.note ?? null;
}

function PublicationTime({ iso, market }: { iso: string; market: Market | undefined }) {
  const viewerTz = viewerTimeZone();
  const at = new Date(iso);
  if (!market || market.timezone === viewerTz) {
    return <strong>{formatDateTime(iso)}</strong>;
  }
  return (
    <>
      <strong>{formatDateTime(iso, market.timezone)}</strong> em{' '}
      {timeZoneLabel(market.timezone, at)} ({formatDateTime(iso, viewerTz)} no seu horário)
    </>
  );
}

/** Aviso contextual no topo da revisão conforme o status da peça. */
export function StatusBanner({
  piece,
  market,
}: {
  piece: ContentPiece;
  market: Market | undefined;
}) {
  const retry = useRetryContentPiece(piece.id);

  switch (piece.status) {
    case 'failed':
      return (
        <InlineAlert
          tone="danger"
          icon={<TriangleAlert />}
          title="A produção desta peça falhou"
          className="items-start"
        >
          <p>{piece.failureReason ?? 'O motivo da falha não foi informado.'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="primary"
              loading={retry.isPending}
              onClick={() =>
                retry.mutate(undefined, {
                  onSuccess: () => toast.success('Produção reiniciada'),
                  onError: (error) =>
                    toast.error('Não foi possível tentar novamente', {
                      description: errorMessage(error),
                    }),
                })
              }
            >
              {retry.isPending ? null : <RotateCw aria-hidden />}
              Tentar novamente
            </Button>
          </div>
        </InlineAlert>
      );
    case 'queued':
    case 'producing':
    case 'ai_review':
      return (
        <InlineAlert tone="info" icon={<Loader2 className="animate-spin" />} title="Em produção">
          Esta página se atualiza sozinha. Quando a revisão automática terminar, a peça aparece para
          a sua aprovação.
        </InlineAlert>
      );
    case 'changes_requested':
      return (
        <InlineAlert tone="warning" icon={<MessageSquareText />} title="Voltou para a edição">
          {lastNoteFor(piece, 'changes_requested') ??
            'Uma nova versão está sendo editada com o seu motivo.'}
        </InlineAlert>
      );
    case 'rejected':
      return (
        <InlineAlert tone="danger" icon={<OctagonX />} title="Reprovada">
          {lastNoteFor(piece, 'rejected') ?? 'Esta adaptação não será publicada.'}
        </InlineAlert>
      );
    case 'approved':
      return (
        <InlineAlert tone="info" icon={<CalendarClock />} title="Aprovada">
          Reservando o próximo horário livre da grade do canal.
        </InlineAlert>
      );
    case 'scheduled':
    case 'published': {
      const publication = piece.publication;
      const published = piece.status === 'published';
      return (
        <InlineAlert
          tone={published ? 'success' : 'info'}
          icon={published ? <CircleCheckBig /> : <CalendarClock />}
          title={published ? 'Publicada' : 'Agendada'}
        >
          {publication ? (
            <>
              <p>
                {published ? 'Programada para ' : 'Vai ao ar em '}
                <PublicationTime iso={publication.scheduledAt} market={market} />.
                {publication.status && !published
                  ? ` Situação: ${publicationStatus(publication.status).label.toLowerCase()}.`
                  : null}
              </p>
              {publication.permalink ? (
                <a
                  href={publication.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                >
                  Ver no Instagram
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </>
          ) : (
            'Os detalhes da publicação ainda não estão disponíveis.'
          )}
        </InlineAlert>
      );
    }
    default:
      return null;
  }
}
