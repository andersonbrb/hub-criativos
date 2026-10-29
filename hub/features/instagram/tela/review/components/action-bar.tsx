'use client';

import { Check, Undo2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/features/instagram/tela/ui/button';
import { Kbd } from '@/features/instagram/tela/ui/feedback';
import { Tooltip } from '@/features/instagram/tela/ui/tooltip';

interface ActionBarProps {
  /** Motivo pelo qual não dá para aprovar; `null` habilita "Aprovar". */
  approveBlocker: string | null;
  pendingAction: 'approve' | 'request_changes' | 'reject' | null;
  onApprove: () => void;
  onRequestChanges: () => void;
  onReject: () => void;
  summary: ReactNode;
}

function Shortcut({ label, keyName }: { label: ReactNode; keyName: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      <span className="flex items-center gap-1 text-bg/70">
        Atalho <Kbd>{keyName}</Kbd>
      </span>
    </span>
  );
}

/** Barra fixa com as três decisões do revisor: aprovar, reprovar ou voltar para a edição. */
export function ActionBar({
  approveBlocker,
  pendingAction,
  onApprove,
  onRequestChanges,
  onReject,
  summary,
}: ActionBarProps) {
  const busy = pendingAction !== null;
  const approveButton = (
    <Button
      variant="approve"
      size="lg"
      onClick={onApprove}
      disabled={approveBlocker !== null || busy}
      loading={pendingAction === 'approve'}
      aria-describedby={approveBlocker ? 'approve-blocker' : undefined}
    >
      {pendingAction === 'approve' ? null : <Check aria-hidden />}
      Aprovar
    </Button>
  );

  return (
    <div
      role="region"
      aria-label="Decisão do revisor"
      className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-border bg-surface/95 px-4 py-3 shadow-bar backdrop-blur-md md:-mx-8 md:px-8"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm text-ink-muted">{summary}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip content={<Shortcut label="Reprovar e encerrar esta adaptação" keyName="R" />}>
            <Button variant="danger" size="lg" onClick={onReject} disabled={busy}>
              <X aria-hidden />
              Reprovar
            </Button>
          </Tooltip>
          <Tooltip
            content={
              <Shortcut
                label="Volta para a edição com o seu motivo; o que já foi aprovado é reaproveitado"
                keyName="J"
              />
            }
          >
            <Button variant="changes" size="lg" onClick={onRequestChanges} disabled={busy}>
              <Undo2 aria-hidden />
              Reprovar e voltar para edição
            </Button>
          </Tooltip>
          {approveBlocker ? (
            <Tooltip content={approveBlocker}>
              {/* Botão desabilitado não recebe foco nem ponteiro: o span carrega o tooltip. */}
              <span tabIndex={0} className="inline-flex rounded-lg" data-testid="approve-wrapper">
                {approveButton}
              </span>
            </Tooltip>
          ) : (
            <Tooltip content={<Shortcut label="Aprovar e agendar" keyName="A" />}>
              {approveButton}
            </Tooltip>
          )}
        </div>
      </div>
      {approveBlocker ? (
        <p id="approve-blocker" className="sr-only">
          {approveBlocker}
        </p>
      ) : null}
    </div>
  );
}
