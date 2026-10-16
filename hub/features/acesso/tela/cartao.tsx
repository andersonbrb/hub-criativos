"use client";

import { useState } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";

import { VitrineDoHub } from "@/features/acesso/tela/vitrine";
import { cn } from "@/lib/utils";

// Moldura das telas fora do menu (entrar, aceitar convite): a vitrine do hub à esquerda e o cartão de vidro à direita,
// no padrão do Ownly e da Cifra. No celular a vitrine vira uma faixa e o cartão sobe por cima dela.
export function CartaoDeAcesso({
  titulo,
  descricao,
  rotulo = "Acesso ao hub",
  children,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  rotulo?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="hub-auth">
      <VitrineDoHub />
      <section className="hub-auth-panel">
        <div className="hub-auth-card hub-spot">
          <span className="hub-eyebrow mb-3.5">{rotulo}</span>
          <h2>{titulo}</h2>
          {descricao && <p className="mb-7 text-[0.90625rem] leading-relaxed text-muted-foreground">{descricao}</p>}
          <div className="grid gap-4">{children}</div>
        </div>
      </section>
    </main>
  );
}

export function Campo({ rotulo, id, children, dica }: { rotulo: string; id: string; children: React.ReactNode; dica?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium">
        {rotulo}
      </label>
      {children}
      {dica && <p className="text-xs leading-relaxed text-muted-foreground">{dica}</p>}
    </div>
  );
}

// Campo com ícone à esquerda (e o botão de mostrar a senha, quando é senha).
export function CampoComIcone({
  icone: Icone,
  className,
  type,
  ...props
}: React.ComponentProps<"input"> & { icone: React.ComponentType<{ className?: string }> }) {
  const [ver, setVer] = useState(false);
  const senha = type === "password";
  return (
    <span className="group/campo relative flex items-center">
      <Icone className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground transition-colors group-focus-within/campo:text-primary dark:group-focus-within/campo:text-[var(--brand-300)]" />
      <input
        data-slot="input"
        type={senha && ver ? "text" : type}
        className={cn(
          "h-11 w-full min-w-0 rounded-[10px] border border-input bg-card pl-10 text-[0.9375rem] shadow-hairline outline-none placeholder:text-muted-foreground hover:border-foreground/30 focus-visible:border-ring dark:bg-white/[0.03]",
          senha ? "pr-11" : "pr-3.5",
          className,
        )}
        {...props}
      />
      {senha && (
        <button
          type="button"
          onClick={() => setVer((v) => !v)}
          aria-label={ver ? "Esconder senha" : "Mostrar senha"}
          aria-pressed={ver}
          title={ver ? "Esconder senha" : "Mostrar senha"}
          className="absolute right-1.5 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
    </span>
  );
}

export function AvisoDeErro({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
