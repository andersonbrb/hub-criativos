import { redirect } from "next/navigation";

import { exigirPagina } from "@/features/acesso/servicos/sessao";

// A Montagem virou a aba Edição (edição final do criativo).
export default async function MontagemPage() {
  await exigirPagina("estudios");
  redirect("/estudios/edicao");
}
