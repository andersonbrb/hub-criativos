'use client';

import type { ReferenceSource } from '@sbs/contracts';
import { ExternalLink, Plus, RefreshCw, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/features/instagram/tela/ui/badge';
import { Button } from '@/features/instagram/tela/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/features/instagram/tela/ui/dialog';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Input } from '@/features/instagram/tela/ui/input';
import { Segmented } from '@/features/instagram/tela/ui/segmented';
import { useMe } from '@/features/instagram/tela/session/hooks/use-me';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { formatRelative } from '@/features/instagram/tela/lib/format';
import { referenceSourceStatusMeta } from '@/features/instagram/tela/lib/status';
import { useNow } from '@/features/instagram/tela/lib/use-now';
import {
  useCreateReferenceSource,
  useReferenceSourceConnection,
  useReferenceSources,
  useSyncReferenceSource,
} from '../hooks/use-reference';
import { instagramProfileUrl, parseInstagramHandle } from '../lib/instagram-handle';

type Connection = ReferenceSource['connectionStatus'];

function syncToast(handle: string, result: { imported: number; updated: number }) {
  toast.success(`@${handle} sincronizada`, {
    description: `${result.imported} novos posts e ${result.updated} atualizados.`,
  });
}

function SourceRow({ source, canManage }: { source: ReferenceSource; canManage: boolean }) {
  const now = useNow();
  const connection = useReferenceSourceConnection();
  const sync = useSyncReferenceSource();
  const connected = source.connectionStatus === 'connected';

  function changeConnection(next: Connection) {
    if (next === source.connectionStatus) return;
    connection.mutate(
      { id: source.id, connected: next === 'connected' },
      {
        onSuccess: () =>
          next === 'connected'
            ? toast.success(`@${source.handle} conectada`, {
                description: 'Os posts dela voltam a ser puxados na sincronização.',
              })
            : toast.info(`@${source.handle} desconectada`, {
                description: 'Os posts dela não serão mais puxados. Os já importados continuam.',
              }),
        onError: (error) =>
          toast.error('Não foi possível alterar o status', { description: errorMessage(error) }),
      },
    );
  }

  function runSync() {
    sync.mutate(source.id, {
      onSuccess: (result) => syncToast(source.handle, result),
      onError: (error) =>
        toast.error('Não foi possível sincronizar', { description: errorMessage(error) }),
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft font-display text-lg font-semibold text-primary uppercase"
      >
        {source.handle.charAt(0)}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={instagramProfileUrl(source.handle)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-ink hover:underline"
          >
            @{source.handle}
            <ExternalLink className="size-3.5 text-ink-subtle" aria-label="Abrir no Instagram" />
          </a>
          <StatusBadge meta={referenceSourceStatusMeta[source.connectionStatus]} />
        </div>
        <p className="text-sm text-ink-muted">
          {source.postsCount} {source.postsCount === 1 ? 'post importado' : 'posts importados'} ·{' '}
          {source.lastSyncedAt
            ? `sincronizada ${formatRelative(source.lastSyncedAt, now)}`
            : 'ainda não sincronizada'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <Segmented<Connection>
            label={`Status de @${source.handle}`}
            value={source.connectionStatus}
            onChange={changeConnection}
            options={[
              { value: 'connected', label: 'Conectada' },
              { value: 'disconnected', label: 'Desconectada' },
            ]}
          />
        ) : null}
        <Button
          size="sm"
          onClick={runSync}
          loading={sync.isPending}
          disabled={!connected || connection.isPending}
          title={connected ? undefined : 'Conecte a página para puxar os posts.'}
        >
          {sync.isPending ? null : <RefreshCw aria-hidden />}
          Sincronizar
        </Button>
      </div>
    </li>
  );
}

/**
 * Depois de cadastrar: se a página entrou conectada, já puxa os posts. Fica no componente que
 * continua montado (o formulário fecha antes de a sincronização terminar).
 */
function usePullNewSource() {
  const sync = useSyncReferenceSource();
  return (source: ReferenceSource) => {
    if (source.connectionStatus !== 'connected') {
      toast.success(`@${source.handle} adicionada`, {
        description: 'Está desconectada: conecte quando quiser puxar os posts.',
      });
      return;
    }
    toast.info(`@${source.handle} adicionada`, {
      description: 'Puxando os posts da página… isso leva cerca de 1 minuto.',
    });
    sync.mutate(source.id, {
      onSuccess: (result) => syncToast(source.handle, result),
      onError: (error) =>
        toast.error(`Não foi possível puxar os posts de @${source.handle}`, {
          description: errorMessage(error),
        }),
    });
  };
}

function AddSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: ReferenceSource) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title="Adicionar página de referência"
        description="Uma página do Instagram cujos posts serão adaptados para os mercados."
      >
        {open ? (
          <AddSourceForm
            onDone={() => onOpenChange(false)}
            onCreated={(source) => {
              onCreated(source);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddSourceForm({
  onDone,
  onCreated,
}: {
  onDone: () => void;
  onCreated: (source: ReferenceSource) => void;
}) {
  const [value, setValue] = useState('');
  const [connectNow, setConnectNow] = useState(true);
  const [touched, setTouched] = useState(false);
  const create = useCreateReferenceSource();
  const handle = parseInstagramHandle(value);
  const error = touched && !handle ? 'Cole o link do perfil ou digite o @ da página.' : undefined;

  function submit() {
    setTouched(true);
    if (!handle) return;
    create.mutate({ handle, connected: connectNow }, { onSuccess: onCreated });
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="Página do Instagram"
        hint={
          handle ? (
            <>
              Será cadastrada como <strong className="font-medium text-ink">@{handle}</strong>.
            </>
          ) : (
            'Cole o link do perfil (instagram.com/…) ou digite o @.'
          )
        }
        error={error}
        required
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://www.instagram.com/santaespiritualidade/"
          autoComplete="off"
          autoFocus
        />
      </Field>
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          checked={connectNow}
          onChange={(event) => setConnectNow(event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span>
          Conectar e puxar os posts agora
          <span className="block text-xs text-ink-muted">
            Desmarcado, a página entra desconectada e nada é puxado até você conectar.
          </span>
        </span>
      </label>
      {create.isError ? (
        <InlineAlert title="Não foi possível adicionar">{errorMessage(create.error)}</InlineAlert>
      ) : null}
      <DialogFooter>
        <Button type="button" onClick={onDone} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          {create.isPending ? null : <Plus aria-hidden />}
          Adicionar página
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Botão do cabeçalho da aba (só admin). */
export function AddReferenceSourceButton() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const pullNewSource = usePullNewSource();
  if (me.data?.role !== 'admin') return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Adicionar página
      </Button>
      <AddSourceDialog open={open} onOpenChange={setOpen} onCreated={pullNewSource} />
    </>
  );
}

/** Aba "Páginas de referência": as contas de onde vêm os posts e o status de cada uma. */
export function ReferenceSourcesPanel() {
  const sources = useReferenceSources();
  const me = useMe();
  const canManage = me.data?.role === 'admin';
  const [adding, setAdding] = useState(false);
  const pullNewSource = usePullNewSource();

  if (sources.isPending) {
    return (
      <div className="space-y-3" aria-busy aria-label="Carregando páginas">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }
  if (sources.isError) {
    return <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />;
  }
  if (sources.data.length === 0) {
    return (
      <>
        <EmptyState
          icon={<UsersRound />}
          title="Nenhuma página de referência"
          description="Adicione a página do Instagram de onde vêm os conteúdos originais."
          action={
            canManage ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Adicionar página
              </Button>
            ) : undefined
          }
        />
        <AddSourceDialog open={adding} onOpenChange={setAdding} onCreated={pullNewSource} />
      </>
    );
  }

  const connectedCount = sources.data.filter((s) => s.connectionStatus === 'connected').length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        {connectedCount === 0
          ? 'Nenhuma página conectada: a sincronização não puxa nada.'
          : `${connectedCount} ${connectedCount === 1 ? 'página conectada' : 'páginas conectadas'}: só elas são puxadas na sincronização e entram na seleção automática.`}
      </p>
      <ul className="space-y-3">
        {sources.data.map((source) => (
          <SourceRow key={source.id} source={source} canManage={canManage} />
        ))}
      </ul>
    </div>
  );
}
