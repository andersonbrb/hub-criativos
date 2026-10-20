import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Páginas que agrupam telas (Agentes, Estúdios): um cartão por tela, que abre a tela. Sem estado nem
// hooks: serve às páginas do servidor.
export type CartaoDeTela = { href: string; nome: string; descricao?: string; marca?: string; icone: React.ReactNode };

export function PaginaDeGrupo({ titulo, descricao, cartoes }: { titulo: string; descricao: string; cartoes: CartaoDeTela[] }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9 2xl:max-w-[96rem]">
      <header>
        <h1 className="font-heading text-2xl leading-tight text-balance md:text-[1.75rem]">{titulo}</h1>
        <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{descricao}</p>
      </header>
      <section className="hub-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {cartoes.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group/tela flex items-start gap-3.5 rounded-2xl bg-card p-4 text-card-foreground ring-1 ring-border outline-none transition-shadow hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted/60 text-foreground/80 ring-1 ring-border transition-colors group-hover/tela:text-primary">
              {c.icone}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="font-heading text-[0.9375rem] leading-snug font-semibold">{c.nome}</h2>
                {c.marca && <span className="rounded border px-1.5 font-mono text-[0.6875rem] text-muted-foreground">{c.marca}</span>}
              </div>
              {c.descricao && <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{c.descricao}</p>}
            </div>
            <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/tela:opacity-100 group-focus-visible/tela:opacity-100" aria-hidden />
          </Link>
        ))}
      </section>
    </main>
  );
}
