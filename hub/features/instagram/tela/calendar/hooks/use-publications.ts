'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicationFilter, RescheduleInput } from '@sbs/contracts';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

export function usePublications(filter: PublicationFilter) {
  return useQuery({
    queryKey: queryKeys.publications.list(filter),
    queryFn: () => api.listPublications(filter),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

function useInvalidateAfterPublicationChange() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.publications.all });
    void client.invalidateQueries({ queryKey: queryKeys.contentPieces.all });
    void client.invalidateQueries({ queryKey: queryKeys.dashboard });
  };
}

export function useReschedulePublication() {
  const invalidate = useInvalidateAfterPublicationChange();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RescheduleInput }) =>
      api.reschedulePublication(id, input),
    onSuccess: invalidate,
  });
}

export function useCancelPublication() {
  const invalidate = useInvalidateAfterPublicationChange();
  return useMutation({
    mutationFn: (id: string) => api.cancelPublication(id),
    onSuccess: invalidate,
  });
}
