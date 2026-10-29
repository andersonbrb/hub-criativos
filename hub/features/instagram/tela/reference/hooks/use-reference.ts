'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductionOptions, ReferencePost } from '@sbs/contracts';
import { api, type ReferencePostFilter } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

export function useReferenceSources() {
  return useQuery({ queryKey: queryKeys.reference.sources, queryFn: api.listReferenceSources });
}

export function useReferencePosts(filter: ReferencePostFilter = {}) {
  return useQuery({
    queryKey: queryKeys.reference.posts(filter),
    queryFn: () => api.listReferencePosts(filter),
  });
}

function useInvalidateReference() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.reference.all });
    void client.invalidateQueries({ queryKey: queryKeys.contentPieces.all });
    void client.invalidateQueries({ queryKey: queryKeys.dashboard });
  };
}

export function useSyncReference() {
  const invalidate = useInvalidateReference();
  return useMutation({ mutationFn: api.syncReference, onSuccess: invalidate });
}

export function useCreateReferenceSource() {
  const invalidate = useInvalidateReference();
  return useMutation({ mutationFn: api.createReferenceSource, onSuccess: invalidate });
}

export function useReferenceSourceConnection() {
  const invalidate = useInvalidateReference();
  return useMutation({
    mutationFn: ({ id, connected }: { id: string; connected: boolean }) =>
      api.updateReferenceSourceConnection(id, connected),
    onSuccess: invalidate,
  });
}

/** Sincroniza uma página só (a que acabou de ser cadastrada ou conectada). */
export function useSyncReferenceSource() {
  const invalidate = useInvalidateReference();
  return useMutation({ mutationFn: api.syncReferenceSource, onSuccess: invalidate });
}

export function useSelectTopReference() {
  const invalidate = useInvalidateReference();
  return useMutation({ mutationFn: api.selectTopReference, onSuccess: invalidate });
}

const postsPrefix = ['reference', 'posts'] as const;

export interface ReferencePostActionInput {
  id: string;
  /** Só na seleção: quem traduz o reel e em que modo. */
  production?: ProductionOptions;
}

/** Selecionar / ignorar com atualização otimista do status em todas as listas carregadas. */
export function useReferencePostAction(action: 'select' | 'ignore') {
  const client = useQueryClient();
  const invalidate = useInvalidateReference();
  return useMutation({
    mutationFn: ({ id, production }: ReferencePostActionInput) =>
      action === 'select'
        ? api.selectReferencePost(id, production ? { production } : undefined)
        : api.ignoreReferencePost(id),
    onMutate: async ({ id }) => {
      await client.cancelQueries({ queryKey: postsPrefix });
      const snapshot = client.getQueriesData<ReferencePost[]>({ queryKey: postsPrefix });
      const status = action === 'select' ? 'selected' : 'ignored';
      client.setQueriesData<ReferencePost[]>({ queryKey: postsPrefix }, (posts) =>
        posts?.map((post) => (post.id === id ? { ...post, status } : post)),
      );
      return { snapshot };
    },
    onError: (_error, _input, context) => {
      context?.snapshot.forEach(([key, data]) => client.setQueryData(key, data));
    },
    onSettled: invalidate,
  });
}

/** Modelos de imagem da FLORA para escolher ao selecionar (lista ao vivo, guardada 10 min). */
export function useFloraImageModels(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.floraImageModels,
    queryFn: api.floraImageModels,
    enabled,
    staleTime: 10 * 60_000,
  });
}
