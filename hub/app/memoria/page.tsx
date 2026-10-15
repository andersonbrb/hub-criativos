import { connection } from "next/server";

import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { indiceDeProjetos, listarIndice, pendentesDeRevisao } from "@/features/memoria/servicos/memoria";
import { MemoriaView, type Aba } from "@/features/memoria/tela/memoria-view";

const ABAS: Aba[] = ["documentos", "projetos", "revisao"];

// Memória da operação: documentos por tipo (com busca), índice de projetos gerado e fila de revisão.
// /memoria?aba=projetos ou ?aba=revisao abre direto na aba.
export default async function MemoriaPage({ searchParams }: PageProps<"/memoria">) {
  await connection();
  await exigirPagina("memoria");
  const { aba } = await searchParams;
  const [documentos, projetos, pendentes] = await Promise.all([listarIndice(), indiceDeProjetos(), pendentesDeRevisao()]);
  return (
    <MemoriaView
      documentos={documentos}
      projetos={projetos}
      pendentes={pendentes}
      abaInicial={ABAS.includes(aba as Aba) ? (aba as Aba) : "documentos"}
    />
  );
}
