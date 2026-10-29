'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

/** Padrão de Edição que o diretor de edição e os especialistas de copy seguem. */
export function useEditingStandard() {
  return useQuery({ queryKey: queryKeys.editingStandard, queryFn: api.getEditingStandard });
}

export function useUpdateEditingStandard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.updateEditingStandard,
    onSuccess: (standard) => client.setQueryData(queryKeys.editingStandard, standard),
  });
}
