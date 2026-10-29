'use client';

import type { Channel, Market } from '@sbs/contracts';
import { AtSign, Globe2, Images, Lock, Pencil, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/features/instagram/tela/ui/page-header';
import { Badge, Tag } from '@/features/instagram/tela/ui/badge';
import { Button } from '@/features/instagram/tela/ui/button';
import { Card } from '@/features/instagram/tela/ui/card';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { MarketChip } from '@/features/instagram/tela/ui/media';
import { useCanManageMarkets, useMe } from '@/features/instagram/tela/session/hooks/use-me';
import { timeZoneLabel } from '@/features/instagram/tela/lib/format';
import { localeDisplayName } from '@/features/instagram/tela/lib/market-display';
import { useChannels, useMarkets } from '../hooks/use-markets';
import { summarizePlan } from '../lib/posting-plan';
import { PostingPlanDialog } from './channel-dialogs';
import { MarketFormDialog } from './market-form-dialog';

function ChannelRow({
  channel,
  market,
  canManage,
}: {
  channel: Channel;
  market: Market;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const plan = [...channel.postingPlan].sort((a, b) => a.localTime.localeCompare(b.localTime));
  return (
    <li className="rounded-lg border border-border bg-surface-sunken/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <AtSign className="size-3.5 text-ink-subtle" aria-hidden />
            {channel.handle}
          </p>
          <p className="text-xs text-ink-muted">{channel.displayName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={channel.connectionStatus === 'connected' ? 'success' : 'neutral'} dot>
            {channel.connectionStatus === 'connected' ? 'Conectado' : 'Não conectado'}
          </Badge>
          {canManage ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Editar grade
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5">
        <p className="mb-1.5 text-xs text-ink-muted">{summarizePlan(plan)}</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Grade de postagem">
          {plan.map((slot) => (
            <li key={slot.localTime}>
              <Tag className="bg-surface text-xs text-ink">
                {slot.format === 'reel' ? <Play aria-hidden /> : <Images aria-hidden />}
                <span className="tabular-nums">{slot.localTime}</span>
                <span className="text-ink-muted">
                  {slot.format === 'reel' ? 'Reel' : 'Carrossel'}
                </span>
              </Tag>
            </li>
          ))}
        </ul>
      </div>
      <PostingPlanDialog
        channel={channel}
        market={market}
        open={editing}
        onOpenChange={setEditing}
      />
    </li>
  );
}

function MarketCard({
  market,
  channels,
  canManage,
}: {
  market: Market;
  channels: Channel[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const now = new Date();

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold text-ink">{market.name}</h2>
            <Badge tone={market.status === 'active' ? 'success' : 'neutral'} dot>
              {market.status === 'active' ? 'Ativo' : 'Pausado'}
            </Badge>
          </div>
          <MarketChip market={market} showName={false} size="sm" />
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            Editar
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">Produto</dt>
          <dd className="font-medium text-ink">{market.productName}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Idioma</dt>
          <dd className="text-ink">
            {localeDisplayName(market.locale)}{' '}
            <span className="text-xs text-ink-subtle">({market.locale})</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Fuso</dt>
          <dd className="text-ink">{timeZoneLabel(market.timezone, now)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">Oferta</dt>
          <dd className="truncate">
            <a
              href={market.offerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              {market.offerUrl.replace(/^https?:\/\//, '')}
            </a>
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-ink-muted">Glossário</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {market.glossary.length === 0 ? (
              <span className="text-ink-subtle">Nenhum termo</span>
            ) : (
              market.glossary.map((term) => (
                <Tag key={term.source} className="text-xs">
                  <span className="text-ink-muted">{term.source}</span>
                  <span aria-hidden className="text-ink-subtle">
                    ›
                  </span>
                  <span className="sr-only">vira</span>
                  <span className="text-ink">{term.target}</span>
                </Tag>
              ))
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-ink-muted">Termos proibidos</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {market.forbiddenTerms.length === 0 ? (
              <span className="text-ink-subtle">Nenhum</span>
            ) : (
              market.forbiddenTerms.map((term) => (
                <Badge key={term} tone="danger">
                  {term}
                </Badge>
              ))
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-auto space-y-2.5 border-t border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Canais</h3>
          {canManage ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href="/instagram/configuracoes">
                <Plus aria-hidden />
                Conectar conta
              </Link>
            </Button>
          ) : null}
        </div>
        {channels.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong/70 px-3 py-4 text-center text-sm text-ink-muted">
            Sem conta do Instagram. Conecte uma em Configurações → Integrações → Instagram,
            escolhendo este mercado.
          </p>
        ) : (
          <ul className="space-y-2">
            {channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                market={market}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </div>

      <MarketFormDialog open={editing} onOpenChange={setEditing} market={market} />
    </Card>
  );
}

export function MarketsView() {
  const markets = useMarkets();
  const channels = useChannels();
  const me = useMe();
  const canManage = useCanManageMarkets();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Mercados"
        description="Cada mercado tem idioma, fuso, produto e oferta próprios. Um mercado novo é só configuração."
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              Novo mercado
            </Button>
          ) : null
        }
      />

      {me.data && !canManage ? (
        <InlineAlert tone="info" icon={<Lock />} className="mb-5">
          Somente administradores editam mercados, canais e grades. Você pode consultar tudo aqui.
        </InlineAlert>
      ) : null}

      {markets.isPending ? (
        <div className="grid gap-5 lg:grid-cols-2" aria-busy aria-label="Carregando mercados">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : markets.isError ? (
        <ErrorState error={markets.error} onRetry={() => void markets.refetch()} />
      ) : markets.data.length === 0 ? (
        <EmptyState
          icon={<Globe2 />}
          title="Nenhum mercado cadastrado"
          description="Cadastre o primeiro mercado (ex.: Espanha, com San Benito) para começar a adaptar."
          action={
            canManage ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Novo mercado
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {markets.data.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              channels={(channels.data ?? []).filter((channel) => channel.marketId === market.id)}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      <MarketFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
