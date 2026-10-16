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

// Link que o admin mandou: mostra para qual organização e e-mail é o convite. Quem ainda não tem conta cria com nome e
// senha; quem já tem (de outra organização) confirma com a senha de sempre e entra nesta.
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
      titulo={convite.contaExiste ? `Entrar em ${convite.organizacao}` : "Criar sua conta"}
      rotulo="Convite"
      descricao={
        <>
          Convite de <strong className="text-foreground">{convite.organizacao}</strong> para <strong className="text-foreground">{convite.email}</strong>, como{" "}
          {ROTULO_DO_PAPEL[convite.papel].toLowerCase()}. Vale até {new Date(convite.expiraEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
          {convite.contaExiste && " Esse e-mail já tem conta no hub: confirme com a sua senha."}
        </>
      }
    >
      {logado && logado.email !== convite.email && (
        <p className="rounded-[10px] border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Você está logado como {logado.email}. Ao aceitar, este navegador passa a usar a conta {convite.email}.
        </p>
      )}
      <FormularioConvite token={token} nomeSugerido={convite.nome ?? ""} contaExiste={convite.contaExiste} organizacao={convite.organizacao} />
    </CartaoDeAcesso>
  );
}
