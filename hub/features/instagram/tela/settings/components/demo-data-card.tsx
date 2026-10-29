'use client';

import { CheckCircle2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/features/instagram/tela/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/features/instagram/tela/ui/dialog';
import { InlineAlert, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { useDemoData, usePurgeDemoData } from '../hooks/use-demo-data';
import { describeDemoData, hasDemoData } from '../lib/demo-data';

/** Remove os posts de exemplo e o que derivou deles. Só aparece para admin. */
export function DemoDataCard() {
  const summary = useDemoData(true);
  const purge = usePurgeDemoData();
  const [confirming, setConfirming] = useState(false);

  function runPurge() {
    purge.mutate(undefined, {
      onSuccess: (removed) => {
        setConfirming(false);
        toast.success('Dados de demonstração removidos', {
          description: `Removidos: ${describeDemoData(removed)}.`,
        });
      },
      onError: (error) =>
        toast.error('Não foi possível remover', { description: errorMessage(error) }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Dados de demonstração</CardTitle>
          <CardDescription>
            Posts de exemplo da primeira versão e as adaptações, revisões e agendamentos gerados a
            partir deles. Posts reais, mercados e contas não são afetados.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {summary.isPending ? (
          <Skeleton className="h-9" />
        ) : summary.isError ? (
          <InlineAlert title="Não foi possível verificar">
            {errorMessage(summary.error)}
          </InlineAlert>
        ) : !hasDemoData(summary.data) ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            Nenhum dado de demonstração. Só conteúdo real no painel.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink">
              Encontrados: <strong className="font-medium">{describeDemoData(summary.data)}</strong>
              .
            </p>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              Remover dados de demonstração
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog
        open={confirming}
        onOpenChange={(open) => (purge.isPending ? null : setConfirming(open))}
      >
        <DialogContent
          size="sm"
          title="Remover dados de demonstração?"
          description="Esta ação não pode ser desfeita."
        >
          <p className="text-sm text-ink-muted">
            Serão apagados{' '}
            <strong className="font-medium text-ink">
              {summary.data ? describeDemoData(summary.data) : 'os dados de exemplo'}
            </strong>
            , com o histórico deles. Os posts reais da conta de referência continuam.
          </p>
          <DialogFooter>
            <Button onClick={() => setConfirming(false)} disabled={purge.isPending}>
              Cancelar
            </Button>
            <Button variant="danger-solid" onClick={runPurge} loading={purge.isPending}>
              {purge.isPending ? null : <Trash2 aria-hidden />}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
