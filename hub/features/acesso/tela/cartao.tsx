import { Clapperboard } from "lucide-react";

// Moldura das telas fora do menu (entrar, aceitar convite, sem acesso): marca do hub, título e o conteúdo.
export function CartaoDeAcesso({ titulo, descricao, children }: { titulo: string; descricao?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <section className="flex w-full max-w-sm flex-col gap-5 border bg-card p-6 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center bg-rec text-white">
            <Clapperboard className="size-4" />
          </div>
          <div className="grid leading-tight">
            <span className="font-heading text-base font-bold">Hub de Criativos</span>
            <span className="text-xs text-muted-foreground">Produção de anúncios</span>
          </div>
        </div>
        <div className="grid gap-1">
          <h1 className="font-heading text-xl font-bold tracking-tight">{titulo}</h1>
          {descricao && <p className="text-sm text-muted-foreground">{descricao}</p>}
        </div>
        {children}
      </section>
    </main>
  );
}

export function Campo({ rotulo, id, children, dica }: { rotulo: string; id: string; children: React.ReactNode; dica?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

export function AvisoDeErro({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}
