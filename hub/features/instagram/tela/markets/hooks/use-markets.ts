'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Channel,
  CreateChannelInput,
  CreateMarketInput,
  Market,
  UpdateMarketInput,
  UpdatePostingPlanInput,
} from '@sbs/contracts';
import { useMemo } from 'react';
import { api } from '@/features/instagram/tela/lib/api/endpoints';
import { queryKeys } from '@/features/instagram/tela/lib/api/query-keys';
import { indexMarkets, type MarketIndex } from '@/features/instagram/tela/lib/market-display';

export function useMarkets() {
  return useQuery({
    queryKey: queryKeys.markets.all,
    queryFn: api.listMarkets,
    staleTime: 5 * 60_000,
  });
}

/** Mapa id para mercado, para mostrar nomes e siglas em qualquer tela. */
export function useMarketIndex(): MarketIndex {
  const { data } = useMarkets();
  return useMemo(() => indexMarkets(data), [data]);
}

export function useChannels() {
  return useQuery({
    queryKey: queryKeys.channels.all,
    queryFn: api.listChannels,
    staleTime: 5 * 60_000,
  });
}

export function useChannelIndex(): ReadonlyMap<string, Channel> {
  const { data } = useChannels();
  return useMemo(() => new Map((data ?? []).map((channel) => [channel.id, channel])), [data]);
}

function upsert<T extends { id: string }>(list: T[] | undefined, item: T): T[] {
  if (!list) return [item];
  const exists = list.some((entry) => entry.id === item.id);
  if (!exists) return [...list, item];
  return list.map((entry) => (entry.id === item.id ? item : entry));
}

export function useCreateMarket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMarketInput) => api.createMarket(input),
    onSuccess: (market) => {
      client.setQueryData<Market[]>(queryKeys.markets.all, (list) => upsert(list, market));
      void client.invalidateQueries({ queryKey: queryKeys.markets.all });
      void client.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateMarket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMarketInput }) =>
      api.updateMarket(id, input),
    onSuccess: (market) => {
      client.setQueryData<Market[]>(queryKeys.markets.all, (list) => upsert(list, market));
      void client.invalidateQueries({ queryKey: queryKeys.markets.all });
      void client.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useCreateChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelInput) => api.createChannel(input),
    onSuccess: (channel) => {
      client.setQueryData<Channel[]>(queryKeys.channels.all, (list) => upsert(list, channel));
      void client.invalidateQueries({ queryKey: queryKeys.channels.all });
    },
  });
}

export function useUpdatePostingPlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePostingPlanInput }) =>
      api.updatePostingPlan(id, input),
    onSuccess: (channel) => {
      client.setQueryData<Channel[]>(queryKeys.channels.all, (list) => upsert(list, channel));
      void client.invalidateQueries({ queryKey: queryKeys.channels.all });
    },
  });
}
