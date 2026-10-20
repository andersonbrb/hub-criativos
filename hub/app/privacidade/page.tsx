import type { Metadata } from "next";

import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { MolduraPublica } from "@/features/publico/tela/moldura";
import { Politica } from "@/features/publico/tela/politica";

export const metadata: Metadata = {
  title: "Política de Privacidade · Hub de Criativos",
  description: "Quais dados o Hub de Criativos usa, inclusive os da conta Google conectada ao Drive, e como revogar o acesso.",
};

// Aberta para qualquer pessoa, sem login (proxy.ts): o Google pede o endereço dela para liberar o login com Google.
// Quem está logado vê o mesmo texto dentro do menu do hub.
export default async function PrivacidadePage() {
  if (await usuarioDaSessao())
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <Politica />
      </main>
    );
  return (
    <MolduraPublica>
      <Politica />
    </MolduraPublica>
  );
}
