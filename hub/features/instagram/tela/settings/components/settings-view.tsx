'use client';

import { Clapperboard, PlugZap, ShieldCheck, UserRound, Users, Wrench } from 'lucide-react';
import type { UserRole } from '@sbs/contracts';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/features/instagram/tela/ui/page-header';
import { Badge } from '@/features/instagram/tela/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { Skeleton } from '@/features/instagram/tela/ui/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/features/instagram/tela/ui/tabs';
import { roleLabels, useMe } from '@/features/instagram/tela/session/hooks/use-me';
import { DemoDataCard } from './demo-data-card';
import { EditingStandardPanel } from './editing-standard-panel';
import { IntegrationsPanel } from './integrations-panel';

type SettingsTab = 'integrations' | 'editing' | 'users' | 'maintenance';

const roleDescriptions: Record<UserRole, string[]> = {
  admin: [
    'Cria e edita mercados, canais e grades de postagem',
    'Adiciona páginas de referência e conecta ou desconecta cada uma',
    'Sincroniza e seleciona referências',
    'Aprova, pede ajustes, reprova e reagenda',
    'Edita o Padrão de Edição dos reels',
  ],
  reviewer: [
    'Aprova, pede ajustes e reprova adaptações',
    'Edita legendas antes de aprovar',
    'Reagenda e cancela publicações',
    'Edita o Padrão de Edição dos reels',
    'Consulta mercados e páginas de referência sem editar',
  ],
};

function UsersPanel() {
  const me = useMe();
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Você</CardTitle>
            <CardDescription>
              Sua conta do hub nesta organização. Entram no Instagram o dono, os admins e quem tiver a
              tela Instagram liberada em Equipe.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {me.isPending ? (
            <Skeleton className="h-12" />
          ) : me.data ? (
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                <UserRound className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-medium text-ink">{me.data.name}</p>
                <p className="text-sm text-ink-muted">{me.data.email}</p>
              </div>
              <Badge tone="info" className="ml-auto">
                {roleLabels[me.data.role]}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Não foi possível carregar o usuário.</p>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(roleDescriptions) as UserRole[]).map((role) => (
          <Card key={role} className={me.data?.role === role ? 'border-primary/40' : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-ink-muted" aria-hidden />
                {roleLabels[role]}
              </CardTitle>
              {me.data?.role === role ? <Badge tone="info">Seu papel</Badge> : null}
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted marker:text-ink-subtle">
                {roleDescriptions[role].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-ink-subtle">
        Convites e troca de papéis chegam numa próxima versão.
      </p>
    </div>
  );
}

/** Resultado do login do Instagram: a API devolve o navegador para cá com ?integracao=… */
function useInstagramReturn(onReturn: () => void) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('integracao') !== 'instagram') return;
    onReturn();
    if (params.get('resultado') === 'ok') {
      toast.success(`@${params.get('conta') ?? ''} conectado ao Instagram`, {
        description: 'O acesso vale por 60 dias e é renovado pela plataforma.',
      });
    } else {
      toast.error('Não foi possível conectar o Instagram', {
        description: params.get('mensagem') ?? undefined,
      });
    }
    window.history.replaceState(null, '', window.location.pathname);
  }, [onReturn]);
}

export function SettingsView() {
  const me = useMe();
  const [tab, setTab] = useState<SettingsTab>('integrations');
  const isAdmin = me.data?.role === 'admin';
  useInstagramReturn(useCallback(() => setTab('integrations'), []));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Configurações"
        description="Integrações, Padrão de Edição, acessos e manutenção da plataforma."
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
        <TabsList className="mb-5">
          <TabsTrigger value="integrations">
            <PlugZap className="size-4" aria-hidden />
            Integrações
          </TabsTrigger>
          <TabsTrigger value="editing">
            <Clapperboard className="size-4" aria-hidden />
            Padrão de Edição
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="size-4" aria-hidden />
            Usuários e papéis
          </TabsTrigger>
          {isAdmin ? (
            <TabsTrigger value="maintenance">
              <Wrench className="size-4" aria-hidden />
              Manutenção
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="integrations" className="space-y-3 pt-0">
          <p className="text-sm text-ink-muted">
            Serviços externos que a plataforma usa. As conexões reais entram por etapas; o que não
            está conectado usa um simulador de testes, que não publica nada.
          </p>
          <IntegrationsPanel />
        </TabsContent>

        <TabsContent value="editing" className="space-y-3 pt-0">
          <p className="text-sm text-ink-muted">
            O manual da edição dos reels: depois da tradução, o diretor de edição e os especialistas
            de copy montam os textos na tela seguindo estas regras, e o revisor de edição confere.
          </p>
          <EditingStandardPanel />
        </TabsContent>

        <TabsContent value="users" className="pt-0">
          <UsersPanel />
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="maintenance" className="pt-0">
            <DemoDataCard />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
