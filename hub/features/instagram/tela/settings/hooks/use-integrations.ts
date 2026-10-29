'use client';

import type { IntegrationId } from '@sbs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';

/** Estado das integrações, verificado no servidor. */
export function useIntegrations() {
  return useQuery({ queryKey: queryKeys.integrations, queryFn: api.listIntegrations });
}

/** Depois de mudar uma integração: integrações e canais (status de conexão) mudam juntos. */
function useInvalidateIntegrations() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.integrations });
    void client.invalidateQueries({ queryKey: queryKeys.channels.all });
  };
}

export function useConnectIntegration() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: ({ id, values }: { id: IntegrationId; values: Record<string, string> }) =>
      api.connectIntegration(id, values),
    onSuccess: invalidate,
  });
}

export function useDisconnectIntegration() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({ mutationFn: api.disconnectIntegration, onSuccess: invalidate });
}

/**
 * Leva o navegador ao login oficial do Instagram para conectar uma conta ao mercado escolhido.
 * O @ é lido do próprio Instagram no retorno.
 */
export function useAuthorizeInstagramAccount() {
  return useMutation({
    mutationFn: (marketId: string) =>
      api.authorizeInstagramAccount(marketId, window.location.origin),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useChangeInstagramChannelMarket() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: ({ channelId, marketId }: { channelId: string; marketId: string }) =>
      api.changeInstagramChannelMarket(channelId, marketId),
    onSuccess: invalidate,
  });
}

/** Liga ou desliga a publicação real de uma conta do Instagram. */
export function useSetInstagramChannelPublishing() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: ({ channelId, enabled }: { channelId: string; enabled: boolean }) =>
      api.setInstagramChannelPublishing(channelId, enabled),
    onSuccess: invalidate,
  });
}

export function useDisconnectInstagramChannel() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({ mutationFn: api.disconnectInstagramChannel, onSuccess: invalidate });
}
