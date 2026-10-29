import type { Metadata } from "next";
import { connection } from "next/server";

import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { SecaoInstagram } from "@/features/instagram/tela/secao";

export const metadata: Metadata = { title: { default: "Instagram · Hub de Criativos", template: "%s · Instagram · Hub de Criativos" } };

// A seção Instagram (migrada do "San Benito Social" em 29/10/2026): pega os posts que mais deram resultado na conta de
// referência, adapta para cada mercado, passa pela revisão automática e pela aprovação do social media e publica no
// Instagram de cada país. Precisa da tela Instagram e do banco do hub.
export default async function InstagramLayout({ children }: LayoutProps<"/instagram">) {
  await connection();
  await exigirPagina("instagram");
  if (modoLocalSemBanco()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-9 text-sm text-muted-foreground md:px-8">
        O Instagram usa o banco do hub, que só existe no hub da nuvem. Abra pelo endereço do hub na nuvem.
      </main>
    );
  }
  return <SecaoInstagram>{children}</SecaoInstagram>;
}
