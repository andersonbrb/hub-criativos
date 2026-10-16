import type { Metadata } from "next";
import Link from "next/link";

import { ROTULO_DO_PAPEL, type ConviteParaAceitar } from "@/features/acesso/contrato";
import { ConviteInvalido } from "@/features/acesso/erros";
import { buscarConvite } from "@/features/acesso/servicos/convites";
import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { AvisoDeErro, CartaoDeAcesso } from "@/features/acesso/tela/cartao";
import { FormularioConvite } from "@/features/acesso/tela/formulario-convite";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Aceitar convite · Hub de Criativos", robots: { index: false } };

// Link que o admin mandou: mostra para qual e-mail é o convite e cria a conta com nome e senha.
export default async function AceitarConvitePage({ params }: PageProps<"/aceitar-convite/[token]">) {
  const { token } = await params;
  let convite: ConviteParaAceitar | null = null;
  let erro: string | null = null;
  try {
    convite = await buscarConvite(token);
  } catch (err) {
    if (!(err instanceof ConviteInvalido)) throw err;
    erro = err.message;
  }

  if (!convite) {
    return (
      <CartaoDeAcesso titulo="Convite indisponível" rotulo="Convite">
        <AvisoDeErro>{erro}</AvisoDeErro>
        <Button variant="outline" asChild>
          <Link href="/entrar">Ir para o login</Link>
        </Button>
      </CartaoDeAcesso>
    );
  }

  const logado = await usuarioDaSessao();
  return (
    <CartaoDeAcesso
      titulo="Criar sua conta"
      rotulo="Convite"
      descricao={
        <>
          Convite para <strong className="text-foreground">{convite.email}</strong>, como {ROTULO_DO_PAPEL[convite.papel].toLowerCase()}. Vale até{" "}
          {new Date(convite.expiraEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
        </>
      }
    >
      {logado && (
        <p className="rounded-[10px] border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Você está logado como {logado.email}. Ao criar esta conta, este navegador passa a usar a conta nova.
        </p>
      )}
      <FormularioConvite token={token} nomeSugerido={convite.nome ?? ""} />
    </CartaoDeAcesso>
  );
}
