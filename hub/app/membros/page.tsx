import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { TelaDeMembros } from "@/features/acesso/tela/membros";

export default async function MembrosPage() {
  const eu = await exigirPagina("membros");
  return <TelaDeMembros eu={eu} />;
}
