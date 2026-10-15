import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { caminhoSeguro } from "@/features/acesso/contrato";
import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { CartaoDeAcesso } from "@/features/acesso/tela/cartao";
import { FormularioEntrar } from "@/features/acesso/tela/formulario-entrar";

export const metadata: Metadata = { title: "Entrar · Hub de Criativos", robots: { index: false } };

// Tela de login, fora do menu. ?proximo= é para onde voltar depois (só caminhos do próprio hub).
export default async function EntrarPage({ searchParams }: PageProps<"/entrar">) {
  const { proximo, erro, email } = await searchParams;
  const destino = caminhoSeguro(proximo);
  // Já logado (ex.: abriu /entrar de um favorito): segue direto.
  if (await usuarioDaSessao()) redirect(destino);

  return (
    <CartaoDeAcesso titulo="Entrar" descricao="Use o e-mail e a senha da sua conta do hub.">
      <FormularioEntrar
        proximo={destino}
        erro={typeof erro === "string" ? erro.slice(0, 300) : null}
        email={typeof email === "string" ? email.slice(0, 200) : ""}
      />
    </CartaoDeAcesso>
  );
}
