import { notFound } from "next/navigation";
import { connection } from "next/server";

import { podeUsar } from "@/features/acesso/contrato";
import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { SLUG_VALIDO } from "@/features/memoria/contrato";
import { ler, listarIndice } from "@/features/memoria/servicos/memoria";
import { DocView } from "@/features/memoria/tela/doc-view";

// Um documento da Memória: leitura em markdown, edição com controle de versão, histórico e revisão.
export default async function MemoriaDocPage({ params }: PageProps<"/memoria/[slug]">) {
  await connection();
  const usuario = await exigirPagina("memoria");
  const { slug } = await params;
  const doc = SLUG_VALIDO.test(slug) ? await ler(slug) : null;
  if (!doc) notFound();
  // Os links entre documentos (herdados do repositório antigo) só viram link quando o destino existe.
  const slugs = (await listarIndice()).map((d) => d.slug);
  return <DocView key={doc.slug} inicial={doc} slugs={slugs} podeEditar={podeUsar(usuario, "memoria_editar")} />;
}
