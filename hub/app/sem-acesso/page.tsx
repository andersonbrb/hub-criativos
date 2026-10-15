import type { Metadata } from "next";
import Link from "next/link";
import { Lock, LogOut } from "lucide-react";

import { ehChave, rotuloDaChave, telaInicial } from "@/features/acesso/contrato";
import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sem acesso · Hub de Criativos" };

// Para onde exigirPagina() manda quem está logado mas não tem a chave da tela (?chave=<chave>).
export default async function SemAcessoPage({ searchParams }: PageProps<"/sem-acesso">) {
  const { chave } = await searchParams;
  const usuario = await usuarioDaSessao();
  const tela = ehChave(chave) ? rotuloDaChave(chave) : null;
  const inicio = usuario ? telaInicial(usuario) : null;

  return (
    <main className="grid min-h-[70svh] place-items-center px-4 py-10">
      <section className="flex w-full max-w-md flex-col gap-4 border bg-card p-6">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" />
          <h1 className="font-heading text-xl font-bold tracking-tight">Sem acesso</h1>
        </div>
        <p className="text-sm">
          {tela ? (
            <>
              Sua conta não tem acesso a <strong>{tela}</strong>.
            </>
          ) : (
            "Sua conta não tem acesso a esta tela."
          )}{" "}
          Peça a um admin do hub para liberar na tela Membros.
        </p>
        {usuario && !inicio && <p className="text-sm text-muted-foreground">Sua conta ainda não tem nenhuma tela liberada.</p>}
        <div className="flex flex-wrap gap-2">
          {usuario ? (
            <>
              {inicio && (
                <Button asChild>
                  <Link href={inicio}>Ir para o início</Link>
                </Button>
              )}
              <form method="post" action="/api/acesso/sair">
                <Button type="submit" variant="outline">
                  <LogOut />
                  Entrar com outra conta
                </Button>
              </form>
            </>
          ) : (
            <Button asChild>
              <Link href="/entrar">Entrar</Link>
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
