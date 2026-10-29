'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: api.dashboard,
    refetchInterval: 60_000,
  });
}
