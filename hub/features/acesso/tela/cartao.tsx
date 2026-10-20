"use client";

import { useState } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";

import { HubLogo } from "@/components/hub-logo";
import { ArteDoHub } from "@/features/acesso/tela/vitrine";
import { RodapePublico } from "@/features/publico/tela/moldura";
import { cn } from "@/lib/utils";

// Moldura das telas fora do menu (entrar, aceitar convite), como no ElevenLabs: o formulário à esquerda, num fundo
// limpo, e a arte do hub à direita. No celular fica só o formulário. (rotulo: aceito por compatibilidade; o estilo
// atual não mostra rótulo acima do título.)
export function CartaoDeAcesso({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  rotulo?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="hub-auth">
      <section className="hub-auth-form">
        <HubLogo className="[&_.hub-mark]:size-7 [&_.hub-wordmark]:text-[1.0625rem]" />
        <div className="hub-auth-form-body">
          <h1 className={cn("font-heading text-[1.75rem] leading-tight", !descricao && "mb-7")}>{titulo}</h1>
          {descricao && <p className="mt-2 mb-7 text-sm leading-relaxed text-muted-foreground">{descricao}</p>}
          <div className="grid gap-4">{children}</div>
        </div>
        <RodapePublico />
      </section>
      <ArteDoHub />
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
      <Icone className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground transition-colors group-focus-within/campo:text-foreground" />
      <input
        data-slot="input"
        type={senha && ver ? "text" : type}
        className={cn(
          "h-10 w-full min-w-0 rounded-lg border border-input bg-background pl-10 text-sm outline-none placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-ring",
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
          className="absolute right-1.5 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
    </span>
  );
}

export function AvisoDeErro({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
