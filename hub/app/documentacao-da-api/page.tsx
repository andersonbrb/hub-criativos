import type { Metadata } from "next";
import { headers } from "next/headers";

import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { documentacaoDaApi } from "@/features/api/documentacao";
import { DocumentacaoDaApi } from "@/features/api/tela/documentacao-da-api";
import { basePublicaDeCabecalhos } from "@/features/conector/servicos/config";

export const metadata: Metadata = { title: "Documentação da API · Hub de Criativos" };

// O que outro sistema faz pela API do hub, com o endereço deste hub nos exemplos.
export default async function DocumentacaoDaApiPage() {
  await exigirPagina("integracoes");
  const base = basePublicaDeCabecalhos(await headers());
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9">
      <DocumentacaoDaApi texto={documentacaoDaApi(base)} />
    </main>
  );
}
