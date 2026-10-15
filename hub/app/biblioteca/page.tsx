import { LibraryView } from "@/components/library-view";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

export default async function BibliotecaPage() {
  await exigirPagina("biblioteca");
  return <LibraryView />;
}
