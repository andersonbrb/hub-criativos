'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BookImage, CalendarDays, Columns3, Globe2, House, Settings, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { useDashboard } from '@/features/instagram/tela/dashboard/hooks/use-dashboard';
import { isApiError } from '@/features/instagram/tela/lib/api/errors';
import { cn } from '@/features/instagram/tela/lib/cn';
import { TooltipProvider } from '@/features/instagram/tela/ui/tooltip';

// A seção Instagram do hub (o antigo painel "San Benito Social"): as mesmas telas, com as abas do painel no topo em
// vez da barra lateral própria. O menu do hub tem um item só, "Instagram".

interface Aba {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Mostra a contagem de peças aguardando aprovação. */
  fila?: boolean;
}

const ABAS: readonly Aba[] = [
  { href: '/instagram', label: 'Início', icon: House },
  { href: '/instagram/producao', label: 'Produção', icon: Columns3, fila: true },
  { href: '/instagram/calendario', label: 'Calendário', icon: CalendarDays },
  { href: '/instagram/referencias', label: 'Referências', icon: BookImage },
  { href: '/instagram/mercados', label: 'Mercados', icon: Globe2 },
  { href: '/instagram/configuracoes', label: 'Configurações', icon: Settings },
];

function ativa(pathname: string, href: string): boolean {
  if (href === '/instagram') return pathname === '/instagram';
  if (href === '/instagram/producao' && pathname.startsWith('/instagram/conteudos')) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function novoCliente(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Erros 4xx não melhoram tentando de novo; falhas de rede e 5xx tentam uma vez.
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status !== null && error.status < 500) return false;
          return failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

function Abas() {
  const pathname = usePathname();
  const { data } = useDashboard();
  const fila = data?.counts.awaitingApproval ?? 0;
  return (
    <nav aria-label="Instagram" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 md:-mx-8 md:px-8">
      <ul className="flex min-w-max gap-1">
        {ABAS.map((aba) => {
          const marcada = ativa(pathname, aba.href);
          return (
            <li key={aba.href}>
              <Link
                href={aba.href}
                aria-current={marcada ? 'page' : undefined}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors',
                  marcada
                    ? 'border-foreground font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <aba.icon className="size-4" strokeWidth={1.7} />
                {aba.label}
                {aba.fila && fila > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] leading-5 font-medium text-primary-foreground">
                    {fila}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SecaoInstagram({ children }: { children: ReactNode }) {
  const [cliente] = useState(novoCliente);
  return (
    <QueryClientProvider client={cliente}>
      <TooltipProvider delayDuration={250}>
        <main className="instagram mx-auto flex w-full max-w-7xl flex-col px-4 py-6 md:px-8 md:py-9 2xl:max-w-[96rem]">
          <Abas />
          {children}
        </main>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
