import { sairDaOrganizacao } from "@/features/acesso/servicos/membros";
import { renomearOrganizacao } from "@/features/acesso/servicos/organizacoes";
import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// A organização aberta na sessão.

// Dono ou admin muda o nome.
export const PATCH = route(
  async (request: Request) => {
    const eu = await exigirUsuario("membros");
    const { dados } = await lerCorpo(request);
    return Response.json({ organizacao: await renomearOrganizacao(dados.nome, eu) });
  },
  { chave: "membros" },
);

// Sair da organização: qualquer pessoa da equipe (não precisa da chave da tela Equipe). A sessão passa sozinha para
// outra organização da pessoa, se ela tiver.
export const DELETE = route(async () => {
  await sairDaOrganizacao(await exigirUsuario());
  return Response.json({ ok: true, destino: "/" });
});
