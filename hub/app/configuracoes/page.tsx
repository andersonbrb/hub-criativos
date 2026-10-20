import { redirect } from "next/navigation";

import { menuDaPessoa } from "@/components/nav";
import { telaInicial } from "@/features/acesso/contrato";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

// A página de Configurações saiu do hub: Integrações e o Conector do Claude são itens do menu, e Equipe e Plataforma
// abrem pelo menu da organização. Link antigo cai na primeira tela do pé do menu que a pessoa abre (Integrações, em
// geral) ou, sem nenhuma, na tela inicial dela.
export default async function ConfiguracoesPage() {
  const usuario = await exigirPagina();
  const { rodape } = menuDaPessoa(usuario, modoLocalSemBanco());
  redirect(rodape[0]?.href ?? telaInicial(usuario) ?? "/sem-acesso");
}
