import { trocarOrganizacaoDaSessao } from "@/features/acesso/servicos/sessoes";
import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { exigirUsuario, tokenDaSessao } from "@/features/acesso/servicos/sessao";
import { InputError, route } from "@/lib/server/http";

// Troca a organização aberta nesta sessão (seletor do menu). As outras abas recebem 409 na próxima chamada e
// recarregam já na organização nova.
export const POST = route(async (request: Request) => {
  const eu = await exigirUsuario();
  const { dados } = await lerCorpo(request);
  const id = typeof dados.id === "string" ? dados.id : "";
  if (!(await trocarOrganizacaoDaSessao(await tokenDaSessao(), eu.id, id)))
    throw new InputError("Não deu para abrir essa organização: você não participa dela, foi desativado ou ela está suspensa.");
  return Response.json({ ok: true, destino: "/" });
});
