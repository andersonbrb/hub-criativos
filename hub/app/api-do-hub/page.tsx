import type { Metadata } from "next";
import { connection } from "next/server";

import { PaginaDeGrupo } from "@/components/grade-de-telas";
import { API, telasDaPessoa } from "@/components/nav";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

export const metadata: Metadata = { title: "API · Hub de Criativos" };

// A seção API (o menu tem um item só, "API", como no Skala): um cartão para a documentação e, para dono e admin, um
// para as chaves.
export default async function ApiDoHubPage() {
  const usuario = await exigirPagina("integracoes");
  await connection();
  const telas = telasDaPessoa(API, usuario, modoLocalSemBanco());
  return (
    <PaginaDeGrupo
      titulo="API"
      descricao="Outros sistemas do grupo (como o Skala) falam com o hub pela API, com uma chave criada aqui. A documentação diz o que dá para fazer."
      cartoes={telas.map((t) => ({ href: t.href, nome: t.label, descricao: t.descricao, icone: <t.icon className="size-5" strokeWidth={1.6} /> }))}
    />
  );
}
