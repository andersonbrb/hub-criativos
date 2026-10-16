import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Peças dos cartões da tela Integrações, no formato minimalista da Cifra: logo num quadrado, nome, uma linha de
// descrição, uma caixa com o estado da conexão e as ações embaixo. Sem estado nem hooks: servem à página (servidor)
// e ao cartão do Drive (cliente).

// Logo do serviço em public/logos. `cheia`: a imagem já é um ícone quadrado com fundo próprio e ocupa o quadro todo.
export type Logo = { src: string; cheia?: boolean } | { icone: LucideIcon };

export function LogoDaIntegracao({ logo }: { logo: Logo }) {
  // Fundo branco sempre: as logos são feitas para fundo claro (a da Venice some num fundo escuro).
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border">
      {"icone" in logo ? (
        <logo.icone className="size-5 text-neutral-800" aria-hidden />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- ícone pequeno e fixo, sem ganho em otimizar
        <img src={logo.src} alt="" className={logo.cheia ? "size-full object-cover" : "size-7 object-contain"} />
      )}
    </span>
  );
}

export function CartaoDeIntegracao({
  logo,
  nome,
  descricao,
  children,
  rodape,
}: {
  logo: Logo;
  nome: string;
  descricao: string;
  // A caixa de estado (ou o campo para colar a chave).
  children?: React.ReactNode;
  // Botão principal e links, embaixo.
  rodape?: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3.5 p-4">
        <LogoDaIntegracao logo={logo} />
        <div className="min-w-0 pt-0.5">
          <h2 className="font-heading text-[0.9375rem] leading-snug font-semibold">{nome}</h2>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{descricao}</p>
        </div>
      </div>
      {children && <div className="space-y-2 px-4">{children}</div>}
      {rodape && <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4 pb-4">{rodape}</div>}
      {!rodape && <div className="pb-4" />}
    </Card>
  );
}

// "Ativa" (verde) ou um aviso (amarelo).
export function Selo({ children, tom = "ok" }: { children: React.ReactNode; tom?: "ok" | "aviso" }) {
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium", tom === "ok" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn")}>
      {children}
    </span>
  );
}

// Caixa com a conexão: o que está ligado, o selo e um detalhe curto; ações à direita.
export function CaixaDeStatus({
  titulo,
  selo = "Ativa",
  tom = "ok",
  detalhe,
  acoes,
  children,
}: {
  titulo: React.ReactNode;
  selo?: string;
  tom?: "ok" | "aviso";
  detalhe?: React.ReactNode;
  acoes?: React.ReactNode;
  // Algo a mais embaixo, dentro da caixa (a barra de espaço do Drive).
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{titulo}</p>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Selo tom={tom}>{selo}</Selo>
            {detalhe && <span className="truncate">{detalhe}</span>}
          </p>
        </div>
        {acoes && <div className="flex shrink-0 items-center gap-1">{acoes}</div>}
      </div>
      {children}
    </div>
  );
}

// Link discreto do rodapé ("Abrir no FLORA", "Pegar a chave"), como o "Ver tutorial" da referência.
export function LinkDoRodape({ href, children }: { href: string; children: React.ReactNode }) {
  const externo = /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      {...(externo ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
      {externo && <ArrowUpRight className="size-3.5" aria-hidden />}
    </a>
  );
}
