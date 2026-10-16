import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Lock, LogOut } from "lucide-react";

import { ehChave, rotuloDaChave, telaInicial } from "@/features/acesso/contrato";
import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sem acesso · Hub de Criativos" };

// Para onde exigirPagina() manda quem está logado mas não tem a chave da tela (?chave=<chave>). Explica também o
// caso de quem não tem organização aberta: sem nenhuma, desativado nela ou com ela suspensa (o seletor do menu troca
// para outra organização da pessoa).
export default async function SemAcessoPage({ searchParams }: PageProps<"/sem-acesso">) {
  const { chave } = await searchParams;
  const usuario = await usuarioDaSessao();
  const tela = ehChave(chave) ? rotuloDaChave(chave) : null;
  const inicio = usuario ? telaInicial(usuario) : null;
  const org = usuario?.organizacao;
  const motivo = !usuario
    ? null
    : !org
      ? "Sua conta não participa de nenhuma organização ativa. Peça um convite a quem cuida da equipe."
      : org.situacao === "suspensa"
        ? `A organização ${org.nome} está suspensa. A equipe volta a usar o hub quando ela for reativada.`
        : !usuario.ativo
          ? `Sua conta está desativada em ${org.nome}. Peça a um admin ou dono dela para reativar.`
          : null;

  return (
    <main className="grid min-h-[70svh] place-items-center px-4 py-10">
      <section className="hub-spot flex w-full max-w-md flex-col items-start gap-4 rounded-2xl border bg-card/80 p-7 shadow-glass backdrop-blur-xl">
        <div className="flex flex-col items-start gap-5">
          <span className="hub-empty-icon">
            <Lock className="size-6" />
          </span>
          <h1 className="font-heading text-2xl">Sem acesso</h1>
        </div>
        {motivo ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{motivo}</p>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {tela ? (
              <>
                Sua conta não tem acesso a <strong>{tela}</strong>.
              </>
            ) : (
              "Sua conta não tem acesso a esta tela."
            )}{" "}
            Peça a um admin {org ? `de ${org.nome}` : "do hub"} para liberar na tela Equipe.
          </p>
        )}
        {usuario && !motivo && !inicio && <p className="text-sm text-muted-foreground">Sua conta ainda não tem nenhuma tela liberada nesta organização.</p>}
        {usuario && <p className="text-xs text-muted-foreground">Participa de outra organização? Troque no topo do menu.</p>}
        <div className="flex flex-wrap gap-2">
          {usuario ? (
            <>
              {inicio && (
                <Button asChild>
                  <Link href={inicio}>Ir para o início</Link>
                </Button>
              )}
              {usuario.operaPlataforma && (
                <Button asChild variant="outline">
                  <Link href="/plataforma">
                    <Building2 />
                    Plataforma
                  </Link>
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
