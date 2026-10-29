'use client';

import {
  INTEGRATION_FIELDS,
  instagramRedirectUri,
  type IntegrationChannel,
  type IntegrationId,
  type IntegrationStatus,
} from '@sbs/contracts';
import {
  AudioLines,
  Bot,
  Camera,
  Clapperboard,
  Copy,
  Eraser,
  KeyRound,
  Languages,
  Link2,
  ScanSearch,
  Unplug,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/features/instagram/tela/ui/badge';
import { Button } from '@/features/instagram/tela/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/features/instagram/tela/ui/dialog';
import { ErrorState, InlineAlert, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Input, Select } from '@/features/instagram/tela/ui/input';
import { MarketFormDialog } from '@/features/instagram/tela/markets/components/market-form-dialog';
import { useMarkets } from '@/features/instagram/tela/markets/hooks/use-markets';
import { useMe } from '@/features/instagram/tela/session/hooks/use-me';
import { useReferenceSources } from '@/features/instagram/tela/reference/hooks/use-reference';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { formatLongDate } from '@/features/instagram/tela/lib/format';
import { integrationStatusMeta } from '@/features/instagram/tela/lib/status';
import { useHydrated } from '@/features/instagram/tela/lib/use-hydrated';
import {
  useAuthorizeInstagramAccount,
  useChangeInstagramChannelMarket,
  useConnectIntegration,
  useDisconnectInstagramChannel,
  useDisconnectIntegration,
  useIntegrations,
  useSetInstagramChannelPublishing,
} from '../hooks/use-integrations';
import { formatUsd, usageRatio } from '../lib/integrations';

const INTEGRATIONS: Record<IntegrationId, { icon: LucideIcon; name: string; description: string }> =
  {
    apify: {
      icon: ScanSearch,
      name: 'Apify',
      description:
        'Lê os posts públicos das páginas de referência: vídeos, carrosséis, legendas e métricas.',
    },
    anthropic: {
      icon: Bot,
      name: 'IA (Claude)',
      description: 'Adapta as legendas para cada mercado e faz a revisão automática por IA.',
    },
    vmake: {
      icon: Eraser,
      name: 'vMake',
      description: 'Remove as legendas dos reels: primeira etapa da produção, antes da tradução.',
    },
    elevenlabs: {
      icon: AudioLines,
      name: 'ElevenLabs',
      description: 'Vozes e áudios das adaptações (narração e dublagem).',
    },
    heygen: {
      icon: Languages,
      name: 'HeyGen',
      description: 'Tradução completa de vídeos, com sincronia labial (sempre no modo rápido, como todo o hub).',
    },
    flora: {
      icon: WandSparkles,
      name: 'FLORA',
      description: 'Geração de imagens e vídeos com IA, escolhendo o modelo.',
    },
    instagram: {
      icon: Camera,
      name: 'Instagram',
      description: 'Login oficial da Meta em cada canal dos mercados, para publicar.',
    },
    creative: {
      icon: Clapperboard,
      name: 'Plataforma de criativos',
      description: 'Plataforma interna de vídeo, voz e slides.',
    },
  };

function UsageBar({ usage }: { usage: NonNullable<IntegrationStatus['usage']> }) {
  const ratio = usageRatio(usage);
  return (
    <div className="space-y-1.5 pt-1">
      <div
        role="progressbar"
        aria-label="Consumo do ciclo mensal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={ratio >= 0.8 ? 'h-full bg-warning' : 'h-full bg-success'}
          style={{ width: `${Math.max(ratio * 100, 2)}%` }}
        />
      </div>
      <p className="text-xs text-ink-muted">
        {formatUsd(usage.usedUsd)} de {formatUsd(usage.limitUsd)} usados neste ciclo · renova em{' '}
        {formatLongDate(usage.cycleEndsAt)}
      </p>
    </div>
  );
}

/** Endereço de retorno que precisa estar cadastrado no app da Meta. */
function RedirectUriHint() {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const uri = instagramRedirectUri(window.location.origin);
  return (
    <div className="space-y-1 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
      <p>
        No app da Meta, em <strong className="font-medium text-ink">OAuth redirect URIs</strong>,
        cadastre:
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-ink">{uri}</code>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void navigator.clipboard
              .writeText(uri)
              .then(() => toast.success('Endereço copiado'))
              .catch(() => toast.error('Não foi possível copiar'))
          }
        >
          <Copy aria-hidden />
          Copiar
        </Button>
      </div>
    </div>
  );
}

function ConnectDialog({
  integration,
  open,
  onOpenChange,
}: {
  integration: IntegrationStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = INTEGRATIONS[integration.id];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={`Conectar ${meta.name}`}
        description="A chave é verificada no próprio serviço antes de salvar e fica guardada cifrada."
      >
        {open ? <ConnectForm integration={integration} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectForm({
  integration,
  onDone,
}: {
  integration: IntegrationStatus;
  onDone: () => void;
}) {
  const fields = INTEGRATION_FIELDS[integration.id];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, integration.publicValues[f.key] ?? ''])),
  );
  const connect = useConnectIntegration();
  const meta = INTEGRATIONS[integration.id];

  function submit() {
    connect.mutate(
      { id: integration.id, values },
      {
        onSuccess: (status) => {
          toast.success(`${meta.name} conectado`, {
            description: status.account ? `Conta: ${status.account}.` : undefined,
          });
          onDone();
        },
      },
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {fields.map((field, index) => (
        <Field key={field.key} label={field.label} hint={field.help} required>
          <Input
            type={field.secret ? 'password' : 'text'}
            value={values[field.key] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field.key]: event.target.value }))
            }
            placeholder={field.placeholder}
            autoComplete="off"
            autoFocus={index === 0}
          />
        </Field>
      ))}
      {integration.id === 'instagram' ? <RedirectUriHint /> : null}
      {connect.isError ? (
        <InlineAlert title="Não foi possível conectar">{errorMessage(connect.error)}</InlineAlert>
      ) : null}
      <DialogFooter>
        <Button type="button" onClick={onDone} disabled={connect.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={connect.isPending}>
          {connect.isPending ? null : <KeyRound aria-hidden />}
          Verificar e salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

function DisconnectDialog({
  integration,
  open,
  onOpenChange,
}: {
  integration: IntegrationStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const disconnect = useDisconnectIntegration();
  const meta = INTEGRATIONS[integration.id];
  return (
    <Dialog open={open} onOpenChange={(next) => (disconnect.isPending ? null : onOpenChange(next))}>
      <DialogContent
        size="sm"
        title={`Desconectar ${meta.name}?`}
        description="A credencial salva é apagada. Dá para conectar de novo quando quiser."
      >
        {integration.id === 'instagram' ? (
          <p className="text-sm text-ink-muted">Os canais conectados também serão desconectados.</p>
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={disconnect.isPending}>
            Cancelar
          </Button>
          <Button
            variant="danger-solid"
            loading={disconnect.isPending}
            onClick={() =>
              disconnect.mutate(integration.id, {
                onSuccess: () => {
                  toast.info(`${meta.name} desconectado`);
                  onOpenChange(false);
                },
                onError: (error) =>
                  toast.error('Não foi possível desconectar', { description: errorMessage(error) }),
              })
            }
          >
            Desconectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Escolhe o mercado (país) e leva ao login oficial do Instagram. */
const NEW_COUNTRY = '__novo_pais__';

/**
 * País (mercado) de uma conta do Instagram, com a opção de cadastrar um país novo ali mesmo.
 * O país criado já volta selecionado.
 */
function CountrySelect({
  value,
  onChange,
  disabled,
  label,
  canCreate,
}: {
  value: string;
  onChange: (marketId: string) => void;
  disabled?: boolean;
  label: string;
  canCreate: boolean;
}) {
  const markets = useMarkets();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Select
        aria-label={label}
        value={value}
        disabled={disabled}
        className="w-auto min-w-40"
        onChange={(event) => {
          if (event.target.value === NEW_COUNTRY) setCreating(true);
          else onChange(event.target.value);
        }}
      >
        {(markets.data ?? []).map((market) => (
          <option key={market.id} value={market.id}>
            {market.name}
          </option>
        ))}
        {canCreate ? <option value={NEW_COUNTRY}>+ Adicionar novo país…</option> : null}
      </Select>
      {canCreate ? (
        <MarketFormDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(market) => onChange(market.id)}
        />
      ) : null}
    </>
  );
}

function ConnectInstagramDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const markets = useMarkets();
  const authorize = useAuthorizeInstagramAccount();
  const [marketId, setMarketId] = useState('');
  const selected = marketId || markets.data?.[0]?.id || '';

  return (
    <Dialog open={open} onOpenChange={(next) => (authorize.isPending ? null : onOpenChange(next))}>
      <DialogContent
        size="sm"
        title="Conectar conta do Instagram"
        description="Escolha o país da conta (ou cadastre um novo). Em seguida você entra no Instagram com ela; o @ é lido do próprio Instagram."
      >
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected) return;
            authorize.mutate(selected, {
              onError: (error) =>
                toast.error('Não foi possível abrir o login do Instagram', {
                  description: errorMessage(error),
                }),
            });
          }}
        >
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink">País da conta</p>
            <CountrySelect
              value={selected}
              onChange={setMarketId}
              label="País da conta"
              canCreate
            />
            <p className="text-xs text-ink-muted">
              Não achou o país? Escolha “+ Adicionar novo país…”. Dá para trocar depois.
            </p>
          </div>
          <p className="text-xs text-ink-muted">
            Antes de continuar, confira se o navegador está logado no Instagram com a conta que você
            quer conectar (ou saia para escolher outra no login).
          </p>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={authorize.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={authorize.isPending}
              disabled={!selected}
            >
              {authorize.isPending ? null : <Link2 aria-hidden />}
              Ir para o login do Instagram
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstagramAccounts({
  channels,
  appConnected,
  canManage,
}: {
  channels: IntegrationChannel[];
  appConnected: boolean;
  canManage: boolean;
}) {
  const authorize = useAuthorizeInstagramAccount();
  const disconnect = useDisconnectInstagramChannel();
  const changeMarket = useChangeInstagramChannelMarket();
  const [connecting, setConnecting] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">Contas conectadas</p>
        {canManage ? (
          <Button
            size="sm"
            variant="primary"
            disabled={!appConnected}
            title={appConnected ? undefined : 'Conecte o app do Instagram primeiro.'}
            onClick={() => setConnecting(true)}
          >
            <Link2 aria-hidden />
            Conectar conta do Instagram
          </Button>
        ) : null}
      </div>
      {channels.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-ink-subtle">
          Nenhuma conta ainda. Conecte a conta de cada país.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {channels.map((channel) => {
            const connected = channel.status === 'connected';
            const busy =
              (disconnect.isPending && disconnect.variables === channel.channelId) ||
              (changeMarket.isPending && changeMarket.variables?.channelId === channel.channelId);
            return (
              <li key={channel.channelId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">@{channel.handle}</p>
                  <p className="text-xs text-ink-muted">
                    {connected && channel.expiresAt
                      ? `Acesso válido até ${formatLongDate(channel.expiresAt)}`
                      : connected
                        ? 'Conectada'
                        : 'Ainda não conectada pelo login do Instagram'}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2 text-xs text-ink-muted">
                    País
                    <CountrySelect
                      value={channel.marketId}
                      disabled={busy}
                      label={`País de @${channel.handle}`}
                      canCreate
                      onChange={(marketId) =>
                        changeMarket.mutate(
                          { channelId: channel.channelId, marketId },
                          {
                            onSuccess: () => toast.success(`País de @${channel.handle} alterado`),
                            onError: (error) =>
                              toast.error('Não foi possível trocar o país', {
                                description: errorMessage(error),
                              }),
                          },
                        )
                      }
                    />
                  </div>
                ) : (
                  <span className="text-xs text-ink-muted">País: {channel.marketName}</span>
                )}
                <Badge tone={connected ? 'success' : 'neutral'} dot>
                  {connected ? 'Conectado' : 'Não conectado'}
                </Badge>
                {connected ? (
                  <PublishingSwitch
                    channelId={channel.channelId}
                    handle={channel.handle}
                    enabled={channel.publishing}
                    canManage={canManage}
                  />
                ) : null}
                {canManage ? (
                  connected ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy}
                      onClick={() =>
                        disconnect.mutate(channel.channelId, {
                          onSuccess: () => toast.info(`@${channel.handle} desconectado`),
                          onError: (error) =>
                            toast.error('Não foi possível desconectar', {
                              description: errorMessage(error),
                            }),
                        })
                      }
                    >
                      {busy ? null : <Unplug aria-hidden />}
                      Desconectar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!appConnected || authorize.isPending}
                      onClick={() =>
                        authorize.mutate(channel.marketId, {
                          onError: (error) =>
                            toast.error('Não foi possível abrir o login do Instagram', {
                              description: errorMessage(error),
                            }),
                        })
                      }
                    >
                      <Link2 aria-hidden />
                      Conectar
                    </Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ConnectInstagramDialog open={connecting} onOpenChange={setConnecting} />
    </div>
  );
}

function IntegrationCard({
  integration,
  extra,
  canManage,
}: {
  integration: IntegrationStatus;
  extra?: string;
  canManage: boolean;
}) {
  const meta = INTEGRATIONS[integration.id];
  const Icon = meta.icon;
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const connected = integration.status !== 'disconnected';
  const fromPanel = integration.source === 'panel';

  return (
    <li
      className={
        integration.status === 'connected'
          ? 'rounded-xl border border-success/40 bg-surface p-4 shadow-card'
          : 'rounded-xl border border-border bg-surface p-4 shadow-card'
      }
    >
      <div className="flex flex-wrap items-start gap-4">
        <span
          className={
            integration.status === 'connected'
              ? 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-ink'
              : 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-muted'
          }
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-ink">{meta.name}</h3>
            {integration.id !== 'creative' ? (
              <StatusBadge meta={integrationStatusMeta[integration.status]} />
            ) : (
              <Badge tone="neutral">Em breve</Badge>
            )}
            {integration.account ? (
              <span className="text-xs text-ink-muted">{integration.account}</span>
            ) : null}
          </div>
          <p className="text-sm text-ink-muted">{meta.description}</p>
          {integration.message ? (
            <p
              className={
                integration.status === 'error' ? 'text-xs text-danger' : 'text-xs text-ink-subtle'
              }
            >
              {integration.message}
            </p>
          ) : null}
          {extra ? <p className="text-xs text-ink-subtle">{extra}</p> : null}
          {integration.usage ? <UsageBar usage={integration.usage} /> : null}
        </div>
        {canManage && integration.configurable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={connected ? 'secondary' : 'primary'}
              onClick={() => setConnecting(true)}
            >
              <KeyRound aria-hidden />
              {connected ? 'Trocar chave' : 'Conectar'}
            </Button>
            {fromPanel ? (
              <Button size="sm" variant="ghost" onClick={() => setDisconnecting(true)}>
                <Unplug aria-hidden />
                Desconectar
              </Button>
            ) : null}
          </div>
        ) : null}
        {/* No hub, as chaves e os logins ficam num lugar só: a tela Integrações. */}
        {canManage && !integration.configurable && integration.id !== 'creative' ? (
          <Button size="sm" variant={connected ? 'secondary' : 'primary'} asChild>
            <Link href="/integracoes">
              <KeyRound aria-hidden />
              {connected ? 'Ver em Integrações' : 'Conectar em Integrações'}
            </Link>
          </Button>
        ) : null}
      </div>

      {integration.id === 'instagram' && integration.channels ? (
        <div className="mt-4 space-y-2 sm:pl-14">
          <InstagramAccounts
            channels={integration.channels}
            appConnected={integration.status === 'connected'}
            canManage={canManage}
          />
        </div>
      ) : null}

      <ConnectDialog integration={integration} open={connecting} onOpenChange={setConnecting} />
      <DisconnectDialog
        integration={integration}
        open={disconnecting}
        onOpenChange={setDisconnecting}
      />
    </li>
  );
}

/** Aba Integrações: conectar, trocar e desconectar cada serviço externo pelo painel. */
export function IntegrationsPanel() {
  const integrations = useIntegrations();
  const sources = useReferenceSources();
  const me = useMe();
  const canManage = me.data?.role === 'admin';

  if (integrations.isPending) {
    return (
      <div className="space-y-3" aria-busy aria-label="Verificando integrações">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }
  if (integrations.isError) {
    return <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />;
  }

  const connectedPages = (sources.data ?? []).filter((s) => s.connectionStatus === 'connected');
  const extra: Partial<Record<IntegrationId, string>> = {
    apify:
      connectedPages.length > 0
        ? `Páginas conectadas: ${connectedPages.map((s) => `@${s.handle}`).join(', ')}.`
        : 'Nenhuma página de referência conectada.',
  };

  return (
    <ul className="space-y-3">
      {integrations.data.map((integration) => (
        <IntegrationCard
          key={integration.id}
          integration={integration}
          extra={extra[integration.id]}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

/**
 * Publicação real de uma conta: desligada, as publicações agendadas são simuladas. Ligar pede
 * confirmação, porque as peças aprovadas passam a ir ao ar no Instagram.
 */
function PublishingSwitch({
  channelId,
  handle,
  enabled,
  canManage,
}: {
  channelId: string;
  handle: string;
  enabled: boolean;
  canManage: boolean;
}) {
  const setPublishing = useSetInstagramChannelPublishing();
  const [confirming, setConfirming] = useState(false);

  function apply(next: boolean) {
    setPublishing.mutate(
      { channelId, enabled: next },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.success(
            next
              ? `Publicação real ligada em @${handle}`
              : `Publicação real desligada em @${handle}`,
          );
        },
        onError: (error) =>
          toast.error('Não foi possível mudar a publicação', { description: errorMessage(error) }),
      },
    );
  }

  if (!canManage) {
    return (
      <span className="text-xs text-ink-muted">
        Publicação real: {enabled ? 'ligada' : 'desligada'}
      </span>
    );
  }
  return (
    <>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={setPublishing.isPending}
          onChange={(event) => (event.target.checked ? setConfirming(true) : apply(false))}
          className="size-4 accent-[var(--primary)]"
        />
        Publicação real
      </label>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title={`Ligar a publicação real em @${handle}?`}
          description="As peças aprovadas deste país passam a ir ao ar no Instagram, nos horários da grade. Desligado, a publicação é só simulada."
          size="sm"
        >
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={setPublishing.isPending} onClick={() => apply(true)}>
              Ligar publicação real
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
