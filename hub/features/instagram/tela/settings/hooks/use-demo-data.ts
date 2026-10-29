'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

/** Quantos registros de demonstração existem (só admin consulta). */
export function useDemoData(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.demoData, queryFn: api.demoDataSummary, enabled });
}

/** Remove a demonstração e recarrega tudo: posts, adaptações, agenda e painel mudam juntos. */
export function usePurgeDemoData() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.purgeDemoData,
    onSuccess: () => void client.invalidateQueries(),
  });
}
