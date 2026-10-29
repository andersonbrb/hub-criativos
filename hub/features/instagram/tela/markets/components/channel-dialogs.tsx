'use client';

import type { Channel, Market } from '@sbs/contracts';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/features/instagram/tela/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/features/instagram/tela/ui/dialog';
import { InlineAlert } from '@/features/instagram/tela/ui/feedback';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { timeZoneLabel } from '@/features/instagram/tela/lib/format';
import { useUpdatePostingPlan } from '../hooks/use-markets';
import {
  DEFAULT_POSTING_PLAN,
  toRows,
  validatePostingPlan,
  type PlanRow,
} from '../lib/posting-plan';
import { PostingPlanEditor } from './posting-plan-editor';

interface PlanErrors {
  rowErrors: Record<string, string>;
  formError: string | null;
}

const noPlanErrors: PlanErrors = { rowErrors: {}, formError: null };

export function PostingPlanDialog({
  channel,
  market,
  open,
  onOpenChange,
}: {
  channel: Channel;
  market: Market | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Grade de @${channel.handle}`}
        description={
          market
            ? `Horários no fuso de ${market.name}: ${timeZoneLabel(market.timezone, new Date())}.`
            : 'Horários no fuso do mercado.'
        }
      >
        {open ? <PostingPlanForm channel={channel} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

export function PostingPlanForm({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const [rows, setRows] = useState<PlanRow[]>(() =>
    toRows(channel.postingPlan.length > 0 ? channel.postingPlan : DEFAULT_POSTING_PLAN),
  );
  const [planErrors, setPlanErrors] = useState<PlanErrors>(noPlanErrors);
  const update = useUpdatePostingPlan();

  function submit() {
    const plan = validatePostingPlan(rows);
    if (!plan.ok) {
      setPlanErrors({ rowErrors: plan.rowErrors, formError: plan.formError });
      return;
    }
    setPlanErrors(noPlanErrors);
    update.mutate(
      { id: channel.id, input: { postingPlan: plan.plan } },
      {
        onSuccess: () => {
          toast.success('Grade atualizada', {
            description: 'Vale para as próximas publicações agendadas.',
          });
          onDone();
        },
      },
    );
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PostingPlanEditor
        rows={rows}
        onChange={setRows}
        rowErrors={planErrors.rowErrors}
        formError={planErrors.formError}
      />
      {update.isError ? (
        <InlineAlert title="Não foi possível salvar a grade">
          {errorMessage(update.error)}
        </InlineAlert>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={update.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          Salvar grade
        </Button>
      </DialogFooter>
    </form>
  );
}
