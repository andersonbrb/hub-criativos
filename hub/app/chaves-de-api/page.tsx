import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { PageHeader } from "@/components/page-header";
import { ehAdmin, ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { listarChaves } from "@/features/api/servicos/chaves";
import { ChavesDeApi } from "@/features/api/tela/chaves-de-api";
import { chaveConfigurada } from "@/features/skala/servicos/chave";

export const metadata: Metadata = { title: "Chaves de API · Hub de Criativos" };

// Só dono ou admin (como no Skala). Quem mais abrir o endereço vai para a tela de "sem acesso".
export default async function ChavesDeApiPage() {
  const usuario = await exigirPagina("integracoes");
  if (!ehAdmin(usuario)) redirect("/sem-acesso");
  await connection();
  const chaves = await listarChaves(usuario);
  // A chave fixa do Skala (variável do servidor) entra na Grupo Chegou: o aviso só aparece lá.
  const chaveFixaDoSkala = usuario.organizacao?.id === ORGANIZACAO_PADRAO.id && chaveConfigurada() !== null;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9">
      <PageHeader
        eyebrow="API"
        title="Chaves de API"
        description={
          <>
            Cada chave deixa um sistema de fora (como o Skala) usar a API do hub em nome desta organização. Veja o que dá para fazer na{" "}
            <a href="/documentacao-da-api" className="font-medium text-rec underline underline-offset-2">
              Documentação da API
            </a>
            .
          </>
        }
      />
      <ChavesDeApi chavesIniciais={chaves} chaveFixaDoSkala={chaveFixaDoSkala} />
    </main>
  );
}
