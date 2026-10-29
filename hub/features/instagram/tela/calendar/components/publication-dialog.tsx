'use client';

import type { Channel, ContentPieceSummary, Market, Publication } from '@sbs/contracts';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge, Tag } from '@/features/instagram/tela/ui/badge';
import { Button } from '@/features/instagram/tela/ui/button';
import { Dialog, DialogContent } from '@/features/instagram/tela/ui/dialog';
import { InlineAlert } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Input } from '@/features/instagram/tela/ui/input';
import { MarketChip, MediaThumb } from '@/features/instagram/tela/ui/media';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import {
  formatDateTime,
  fromDateTimeLocalValue,
  timeZoneLabel,
  toDateTimeLocalValue,
  viewerTimeZone,
} from '@/features/instagram/tela/lib/format';
import { formatLabel, publicationStatusMeta } from '@/features/instagram/tela/lib/status';
import { useCancelPublication, useReschedulePublication } from '../hooks/use-publications';
import { canChangePublication, isInFuture } from '../lib/week';

interface PublicationDialogProps {
  publication: Publication | null;
  market: Market | undefined;
  channel: Channel | undefined;
  piece: ContentPieceSummary | undefined;
  onClose: () => void;
}

export function PublicationDialog({
  publication,
  market,
  channel,
  piece,
  onClose,
}: PublicationDialogProps) {
  return (
    <Dialog open={publication !== null} onOpenChange={(open) => (open ? null : onClose())}>
      {publication ? (
        <DialogContent
          title="Publicação"
          description={`${formatLabel(publication.format)} para ${market?.name ?? 'o mercado'}${channel ? ` em @${channel.handle}` : ''}`}
        >
          <PublicationDetails
            key={publication.id}
            publication={publication}
            market={market}
            piece={piece}
            onClose={onClose}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function PublicationDetails({
  publication,
  market,
  piece,
  onClose,
}: {
  publication: Publication;
  market: Market | undefined;
  piece: ContentPieceSummary | undefined;
  onClose: () => void;
}) {
  const marketTz = market?.timezone ?? viewerTimeZone();
  const viewerTz = viewerTimeZone();
  const [value, setValue] = useState(() => toDateTimeLocalValue(publication.scheduledAt, marketTz));
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const reschedule = useReschedulePublication();
  const cancel = useCancelPublication();
  const editable = canChangePublication(publication);
  const newIso = fromDateTimeLocalValue(value, marketTz);

  function submitReschedule() {
    if (!newIso) {
      setFieldError('Informe data e hora.');
      return;
    }
    if (!isInFuture(newIso)) {
      setFieldError('Escolha um horário no futuro.');
      return;
    }
    setFieldError(undefined);
    reschedule.mutate(
      { id: publication.id, input: { scheduledAt: newIso } },
      {
        onSuccess: () => {
          toast.success('Publicação reagendada', {
            description: `Nova data: ${formatDateTime(newIso, marketTz)} (${timeZoneLabel(marketTz, new Date(newIso))}).`,
          });
          onClose();
        },
      },
    );
  }

  function submitCancel() {
    cancel.mutate(publication.id, {
      onSuccess: () => {
        toast.success('Publicação cancelada');
        onClose();
      },
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <MediaThumb
          src={piece?.thumbnailUrl}
          alt=""
          format={publication.format}
          className="w-20 shrink-0"
        />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <MarketChip market={market} fallbackId={publication.marketId} size="sm" />
            <StatusBadge meta={publicationStatusMeta[publication.status]} />
            {publication.attempts > 0 ? <Tag>{publication.attempts} tentativa(s)</Tag> : null}
          </div>
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline text-ink-muted">No mercado: </dt>
              <dd className="inline font-medium text-ink">
                {formatDateTime(publication.scheduledAt, marketTz)} (
                {timeZoneLabel(marketTz, new Date(publication.scheduledAt))})
              </dd>
            </div>
            {marketTz !== viewerTz ? (
              <div>
                <dt className="inline text-ink-muted">No seu horário: </dt>
                <dd className="inline text-ink">
                  {formatDateTime(publication.scheduledAt, viewerTz)}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={`/instagram/conteudos/${publication.contentPieceId}`}
              className="font-medium text-primary hover:underline"
            >
              Abrir peça
            </Link>
            {publication.permalink ? (
              <a
                href={publication.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Ver no Instagram
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {publication.lastError ? (
        <InlineAlert title="Último erro ao publicar">{publication.lastError}</InlineAlert>
      ) : null}

      {editable ? (
        <form
          className="space-y-3 rounded-xl border border-border bg-surface-sunken/60 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitReschedule();
          }}
        >
          <Field
            label={`Nova data e hora (${timeZoneLabel(marketTz, new Date())})`}
            hint={
              newIso && marketTz !== viewerTz
                ? `No seu horário: ${formatDateTime(newIso, viewerTz)}`
                : 'Horário local do mercado.'
            }
            error={fieldError}
          >
            <Input
              type="datetime-local"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
            />
          </Field>
          {reschedule.isError ? (
            <InlineAlert title="Não foi possível reagendar">
              {errorMessage(reschedule.error)}
            </InlineAlert>
          ) : null}
          <Button type="submit" variant="primary" loading={reschedule.isPending}>
            Reagendar
          </Button>
        </form>
      ) : null}

      {editable ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {cancel.isError ? (
            <InlineAlert title="Não foi possível cancelar">
              {errorMessage(cancel.error)}
            </InlineAlert>
          ) : null}
          {confirmCancel ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm text-ink">A peça não será publicada. Confirmar?</p>
              <Button
                variant="ghost"
                onClick={() => setConfirmCancel(false)}
                disabled={cancel.isPending}
              >
                Manter
              </Button>
              <Button variant="danger-solid" onClick={submitCancel} loading={cancel.isPending}>
                Cancelar publicação
              </Button>
            </div>
          ) : (
            <Button variant="danger" className="self-start" onClick={() => setConfirmCancel(true)}>
              Cancelar publicação
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
