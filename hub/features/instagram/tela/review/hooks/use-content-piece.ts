'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ContentPiece, DecisionInput, EditCaptionInput } from '@sbs/contracts';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';
import { isInProduction } from '@/features/instagram/tela/lib/status';

export function useContentPiece(id: string) {
  return useQuery({
    queryKey: queryKeys.contentPieces.detail(id),
    queryFn: () => api.getContentPiece(id),
    // Enquanto o sistema trabalha na peça, acompanha a mudança de status.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && (isInProduction(status) || status === 'approved') ? 5_000 : false;
    },
  });
}

/** Grava a peça devolvida pela API e invalida o que depende dela. */
function syncPiece(client: QueryClient, piece: ContentPiece) {
  client.setQueryData(queryKeys.contentPieces.detail(piece.id), piece);
  void client.invalidateQueries({ queryKey: queryKeys.contentPieces.lists });
  void client.invalidateQueries({ queryKey: queryKeys.dashboard });
  void client.invalidateQueries({ queryKey: queryKeys.publications.all });
}

export function useDecision(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: DecisionInput) => api.decideContentPiece(id, input),
    onSuccess: (piece) => syncPiece(client, piece),
  });
}

export function useEditCaption(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EditCaptionInput) => api.editCaption(id, input),
    onSuccess: (piece) => syncPiece(client, piece),
  });
}

export function useRetryContentPiece(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.retryContentPiece(id),
    onSuccess: (piece) => syncPiece(client, piece),
  });
}

/** Busca a próxima peça aguardando aprovação (diferente da atual), ou `null`. */
export async function fetchNextAwaiting(
  client: QueryClient,
  currentId: string,
): Promise<string | null> {
  const filter = { status: 'awaiting_approval' as const };
  const list = await client.fetchQuery({
    queryKey: queryKeys.contentPieces.list(filter),
    queryFn: () => api.listContentPieces(filter),
    staleTime: 0,
  });
  const next = list.find((piece) => piece.id !== currentId && piece.status === 'awaiting_approval');
  return next?.id ?? null;
}
