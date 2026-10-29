'use client';

import { useQuery } from '@tanstack/react-query';
import type { ContentPieceFilter } from '@sbs/contracts';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

export function useContentPieces(filter: ContentPieceFilter = {}) {
  return useQuery({
    queryKey: queryKeys.contentPieces.list(filter),
    queryFn: () => api.listContentPieces(filter),
    refetchInterval: 30_000,
  });
}
