import Link from "next/link";

import { HubLogo } from "@/components/hub-logo";
import { Button } from "@/components/ui/button";
import { CAMINHO_DA_POLITICA, RESPONSAVEL } from "@/features/publico/contrato";

// Rodapé das páginas fora do menu (apresentação, entrar, convite e política): o responsável e o link da política.
export function RodapePublico() {
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        © {new Date().getFullYear()} {RESPONSAVEL}
      </span>
      <Link href={CAMINHO_DA_POLITICA} className="transition-colors hover:text-foreground">
        Política de Privacidade
      </Link>
    </footer>
  );
}

// Moldura da Política de Privacidade para quem não entrou: a marca (volta para a apresentação) e o botão de entrar.
export function MolduraPublica({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Hub de Criativos: página inicial">
            <HubLogo className="[&_.hub-mark]:size-7 [&_.hub-wordmark]:text-[1.0625rem]" />
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/entrar">Entrar</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">{children}</main>
      <div className="border-t">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          <RodapePublico />
        </div>
      </div>
    </div>
  );
}
