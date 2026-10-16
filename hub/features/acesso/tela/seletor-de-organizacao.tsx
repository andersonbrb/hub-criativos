"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Check, ChevronsUpDown, Loader2, LogOut, Users } from "lucide-react";
import { toast } from "sonner";

import { iniciais } from "@/components/account-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { podeUsar, ROTULO_DO_PAPEL, type MinhaOrganizacao, type Usuario } from "@/features/acesso/contrato";
import { apiFetch } from "@/lib/generations";
import { cn } from "@/lib/utils";

const erroDe = (err: unknown, padrao: string) => (err instanceof Error ? err.message : padrao);

// Página inteira de novo, no início: nada do que estava na tela era da organização nova.
export const recarregarNoInicio = () => window.location.assign(new URL("/", window.location.href));

function Marca({ nome, className }: { nome: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[9px] border border-sidebar-border bg-white/[0.05] font-mono text-[0.6875rem] font-semibold tracking-tight text-sidebar-foreground",
        className,
      )}
    >
      {iniciais(nome)}
    </span>
  );
}

// Seletor de organização no topo do menu (como no Cifra): mostra a organização aberta, troca para outra de que a
// pessoa participa, leva para a Equipe e para a Plataforma, e deixa sair da organização aberta.
export function SeletorDeOrganizacao({ usuario, recolhido = false, lado = "right" }: { usuario: Usuario; recolhido?: boolean; lado?: "right" | "bottom" }) {
  const [organizacoes, setOrganizacoes] = useState<MinhaOrganizacao[] | null>(null);
  const [trocando, setTrocando] = useState<string | null>(null);
  const atual = usuario.organizacao;
  const nome = atual?.nome ?? "Sem organização";

  const carregar = () =>
    apiFetch<{ organizacoes: MinhaOrganizacao[] }>("/api/acesso/organizacoes")
      .then((r) => setOrganizacoes(r.organizacoes))
      .catch((err) => {
        setOrganizacoes([]);
        toast.error(erroDe(err, "Não consegui carregar as suas organizações."));
      });

  async function trocar(org: MinhaOrganizacao) {
    setTrocando(org.id);
    try {
      await apiFetch("/api/acesso/organizacoes/trocar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: org.id }) });
      recarregarNoInicio();
    } catch (err) {
      toast.error(erroDe(err, "Não deu para abrir essa organização."));
      setTrocando(null);
    }
  }

  async function sair() {
    if (!atual) return;
    if (!confirm(`Sair de ${atual.nome}? Você perde o acesso a ela na hora. Para voltar, alguém da equipe precisa convidar você de novo.`)) return;
    try {
      await apiFetch("/api/acesso/organizacao", { method: "DELETE" });
      recarregarNoInicio();
    } catch (err) {
      toast.error(erroDe(err, "Não deu para sair da organização."));
    }
  }

  return (
    <DropdownMenu onOpenChange={(aberto) => aberto && organizacoes === null && carregar()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Organização: ${nome}. Trocar de organização`}
          title={recolhido ? nome : undefined}
          className={cn(
            "flex w-full min-w-0 items-center gap-2.5 rounded-[10px] border border-sidebar-border bg-white/[0.03] p-1.5 text-left text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent",
            recolhido && "justify-center border-transparent bg-transparent p-0",
          )}
        >
          <Marca nome={nome} />
          {!recolhido && (
            <>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <small className="font-mono text-[0.625rem] tracking-[0.14em] text-sidebar-foreground/50 uppercase">Organização</small>
                <strong className="truncate text-[0.8125rem] font-medium text-white">{nome}</strong>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/60" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={lado} align="start" sideOffset={8} className="w-72">
        <DropdownMenuLabel>Suas organizações</DropdownMenuLabel>
        {organizacoes === null ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Carregando…
          </div>
        ) : organizacoes.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">Você não participa de nenhuma organização.</p>
        ) : (
          organizacoes.map((o) => {
            const aberta = o.id === atual?.id;
            const fechada = !o.ativo || o.situacao !== "ativa";
            return (
              <DropdownMenuItem key={o.id} disabled={fechada || trocando !== null} onSelect={(e) => (aberta ? undefined : (e.preventDefault(), trocar(o)))} className="gap-2.5">
                <Marca nome={o.nome} className="size-7 border-border bg-foreground/[0.04] text-foreground" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{o.nome}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {o.situacao === "suspensa" ? "Suspensa" : !o.ativo ? "Você está desativado" : ROTULO_DO_PAPEL[o.papel]}
                  </span>
                </span>
                {trocando === o.id ? <Loader2 className="animate-spin" /> : aberta ? <Check /> : null}
              </DropdownMenuItem>
            );
          })
        )}
        {(podeUsar(usuario, "membros") || usuario.operaPlataforma || atual) && <DropdownMenuSeparator />}
        {podeUsar(usuario, "membros") && (
          <DropdownMenuItem asChild>
            <Link href="/membros">
              <Users />
              Equipe e organização
            </Link>
          </DropdownMenuItem>
        )}
        {usuario.operaPlataforma && (
          <DropdownMenuItem asChild>
            <Link href="/plataforma">
              <Building2 />
              Plataforma
            </Link>
          </DropdownMenuItem>
        )}
        {atual && (
          <DropdownMenuItem variant="destructive" onSelect={sair}>
            <LogOut />
            Sair desta organização
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
