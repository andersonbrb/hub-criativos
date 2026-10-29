'use client';

import { useQuery } from '@tanstack/react-query';
import type { UserRole } from '@sbs/contracts';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    staleTime: 5 * 60_000,
  });
}

export const roleLabels: Record<UserRole, string> = {
  admin: 'Administrador',
  reviewer: 'Revisor',
};

/** Só administradores editam mercados, canais e grades. */
export function useCanManageMarkets(): boolean {
  const { data } = useMe();
  return data?.role === 'admin';
}
