'use client';

import { ImageOff, Images, RefreshCw, Sparkles, UsersRound } from 'lucide-react';
import type { ProductionOptions, ReferencePost } from '@sbs/contracts';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/features/instagram/tela/ui/page-header';
import { Button } from '@/features/instagram/tela/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { Select } from '@/features/instagram/tela/ui/input';
import { Segmented } from '@/features/instagram/tela/ui/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/features/instagram/tela/ui/tabs';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import {
  useReferencePostAction,
  useReferencePosts,
  useReferenceSources,
  useSelectTopReference,
  useSyncReference,
} from '../hooks/use-reference';
import {
  REFERENCE_SORT_LABEL,
  countByFormat,
  countByStatus,
  filterByFormat,
  filterPosts,
  sortPosts,
  type ReferenceFilter,
  type ReferenceFormatFilter,
  type ReferenceSort,
} from '../lib/reference-helpers';
import { ReferencePostCard } from './reference-post-card';
import { SelectPostDialog } from './select-post-dialog';
import { AddReferenceSourceButton, ReferenceSourcesPanel } from './reference-sources-panel';

type ReferenceTab = 'posts' | 'pages';

function SourceLine() {
  const sources = useReferenceSources();
  if (!sources.data) return null;
  const connected = sources.data.filter((s) => s.connectionStatus === 'connected');
  if (connected.length === 0) return <span>Nenhuma página conectada.</span>;
  return (
    <span>
      Puxando de{' '}
      {connected.map((source, index) => (
        <span key={source.id}>
          {index > 0 ? ', ' : null}
          <strong className="font-medium text-ink">@{source.handle}</strong>
        </span>
      ))}
      .
    </span>
  );
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      aria-busy
      aria-label="Carregando posts"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="aspect-[4/7] rounded-xl" />
      ))}
    </div>
  );
}

export function ReferenceView() {
  const [tab, setTab] = useState<ReferenceTab>('posts');
  const [filter, setFilter] = useState<ReferenceFilter>('all');
  const [sort, setSort] = useState<ReferenceSort>('performance');
  const [sourceId, setSourceId] = useState('all');
  const [format, setFormat] = useState<ReferenceFormatFilter>('all');
  const posts = useReferencePosts();
  const sources = useReferenceSources();
  const sync = useSyncReference();
  const selectTop = useSelectTopReference();
  const select = useReferencePostAction('select');
  const ignore = useReferencePostAction('ignore');
  // Antes de selecionar: quem traduz o vídeo (reel) e o modelo das imagens (FLORA).
  const [choosing, setChoosing] = useState<ReferencePost | null>(null);

  const handles = new Map((sources.data ?? []).map((s) => [s.id, s.handle]));
  const bySource = useMemo(
    () => (posts.data ?? []).filter((p) => sourceId === 'all' || p.sourceId === sourceId),
    [posts.data, sourceId],
  );
  const formatCounts = countByFormat(bySource);
  // O ranking (1º, 2º…) é dentro do formato escolhido.
  const all = useMemo(
    () => sortPosts(filterByFormat(bySource, format), sort),
    [bySource, format, sort],
  );
  const counts = countByStatus(all);
  const visible = filterPosts(all, filter);
  const ranks = new Map(all.map((post, index) => [post.id, index + 1]));

  function runSync() {
    sync.mutate(undefined, {
      onSuccess: (result) =>
        result.sources === 0
          ? toast.info('Nenhuma página conectada', {
              description: 'Conecte uma página na aba Páginas de referência para puxar os posts.',
            })
          : toast.success('Referências sincronizadas', {
              description: `${result.sources} ${result.sources === 1 ? 'página' : 'páginas'}: ${result.imported} novos posts e ${result.updated} atualizados.`,
            }),
      onError: (error) =>
        toast.error('Não foi possível sincronizar', { description: errorMessage(error) }),
    });
  }

  function runSelectTop() {
    selectTop.mutate(undefined, {
      onSuccess: (result) =>
        result.selected.length > 0
          ? toast.success(
              result.selected.length === 1
                ? '1 post selecionado'
                : `${result.selected.length} posts selecionados`,
              { description: 'As adaptações para cada mercado ativo já entraram em produção.' },
            )
          : toast.info('Nenhum post novo entre os melhores', {
              description:
                'Os posts mais fortes já foram selecionados ou ainda são muito recentes.',
            }),
      onError: (error) =>
        toast.error('Não foi possível selecionar', { description: errorMessage(error) }),
    });
  }

  function act(kind: 'select' | 'ignore', id: string, production?: ProductionOptions) {
    const mutation = kind === 'select' ? select : ignore;
    mutation.mutate(
      { id, production },
      {
        onSuccess: () => {
          setChoosing(null);
          toast.success(kind === 'select' ? 'Post selecionado' : 'Post ignorado', {
            description:
              kind === 'select'
                ? 'As adaptações para cada mercado ativo entraram em produção.'
                : undefined,
          });
        },
        onError: (error) =>
          toast.error(
            kind === 'select' ? 'Não foi possível selecionar' : 'Não foi possível ignorar',
            {
              description: errorMessage(error),
            },
          ),
      },
    );
  }

  const busyId = select.isPending
    ? select.variables.id
    : ignore.isPending
      ? ignore.variables.id
      : null;

  return (
    <div>
      <PageHeader
        title="Referências"
        description={
          <>
            Posts das páginas de referência, lidos do perfil público. <SourceLine />
          </>
        }
        actions={
          <>
            <Button onClick={runSync} loading={sync.isPending}>
              {sync.isPending ? null : <RefreshCw aria-hidden />}
              Sincronizar
            </Button>
            <Button onClick={runSelectTop} loading={selectTop.isPending}>
              {selectTop.isPending ? null : <Sparkles aria-hidden />}
              Selecionar melhores
            </Button>
            <AddReferenceSourceButton />
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as ReferenceTab)}>
        <TabsList className="mb-5">
          <TabsTrigger value="posts">
            <Images className="size-4" aria-hidden />
            Posts
            <span className="text-xs text-ink-subtle tabular-nums">{posts.data?.length}</span>
          </TabsTrigger>
          <TabsTrigger value="pages">
            <UsersRound className="size-4" aria-hidden />
            Páginas de referência
            <span className="text-xs text-ink-subtle tabular-nums">{sources.data?.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pages" className="pt-0">
          <ReferenceSourcesPanel />
        </TabsContent>

        <TabsContent value="posts" className="pt-0">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Segmented<ReferenceFormatFilter>
              label="Filtrar por formato"
              value={format}
              onChange={setFormat}
              options={[
                { value: 'all', label: 'Todos os formatos', count: formatCounts.all },
                { value: 'reel', label: 'Reels', count: formatCounts.reel },
                { value: 'carousel', label: 'Carrosséis', count: formatCounts.carousel },
                { value: 'image', label: 'Fotos', count: formatCounts.image },
              ]}
            />
            <Segmented<ReferenceFilter>
              label="Filtrar por status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Todos', count: counts.all },
                { value: 'new', label: 'Novos', count: counts.new },
                { value: 'selected', label: 'Selecionados', count: counts.selected },
                { value: 'ignored', label: 'Ignorados', count: counts.ignored },
              ]}
            />
            <Segmented<ReferenceSort>
              label="Ordenar por"
              value={sort}
              onChange={setSort}
              options={(Object.keys(REFERENCE_SORT_LABEL) as ReferenceSort[]).map((value) => ({
                value,
                label: REFERENCE_SORT_LABEL[value],
              }))}
            />
            {(sources.data?.length ?? 0) > 1 ? (
              <Select
                aria-label="Filtrar por página"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                className="w-auto"
              >
                <option value="all">Todas as páginas</option>
                {sources.data?.map((source) => (
                  <option key={source.id} value={source.id}>
                    @{source.handle}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>

          {posts.isPending ? (
            <GridSkeleton />
          ) : posts.isError ? (
            <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
          ) : bySource.length === 0 ? (
            <EmptyState
              icon={<RefreshCw />}
              title="Nenhum post importado"
              description="Sincronize as páginas conectadas para trazer os posts e as métricas mais recentes."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={runSync} loading={sync.isPending}>
                    Sincronizar agora
                  </Button>
                  <Button onClick={() => setTab('pages')}>Ver páginas</Button>
                </div>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<ImageOff />}
              title="Nenhum post com estes filtros"
              action={
                <Button
                  onClick={() => {
                    setFilter('all');
                    setFormat('all');
                  }}
                >
                  Ver todos
                </Button>
              }
            />
          ) : (
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visible.map((post) => (
                <li key={post.id}>
                  <ReferencePostCard
                    post={post}
                    sourceHandle={handles.get(post.sourceId) ?? null}
                    rank={ranks.get(post.id) ?? null}
                    busy={busyId === post.id}
                    onSelect={() => setChoosing(post)}
                    onIgnore={() => act('ignore', post.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <SelectPostDialog
        key={choosing?.id ?? 'none'}
        post={choosing}
        busy={select.isPending}
        onCancel={() => setChoosing(null)}
        onConfirm={(production) => choosing && act('select', choosing.id, production)}
      />
    </div>
  );
}
