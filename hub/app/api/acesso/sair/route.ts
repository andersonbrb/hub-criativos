import { cookies } from "next/headers";

import { caminhoSeguro, COOKIE_SESSAO } from "@/features/acesso/contrato";
import { sair } from "@/features/acesso/servicos/login";
import { cookieApagado, exigirMesmoSite, lerCorpo, redirecionar } from "@/features/acesso/servicos/pedido";
import { route } from "@/lib/server/http";

// Sai da conta: apaga a sessão no banco e o cookie. Aberta de propósito: com a sessão já vencida, sair ainda
// precisa limpar o cookie em vez de responder "entre para continuar".
//
// Contrato (usado pelo "Entrar com outra conta" do Conector):
// - formulário HTML (POST) com o campo opcional "proximo" → 303 para /entrar?proximo=<proximo>;
// - fetch sem corpo ou com JSON { proximo? } → 200 { ok: true, destino } e o navegador vai para o destino.
export const POST = route(
  async (request: Request) => {
    exigirMesmoSite(request);
    await sair((await cookies()).get(COOKIE_SESSAO)?.value);
    const { dados, formulario } = await lerCorpo(request);
    const proximo = dados.proximo === undefined ? null : caminhoSeguro(dados.proximo);
    const destino = proximo ? `/entrar?proximo=${encodeURIComponent(proximo)}` : "/entrar";
    if (formulario) return redirecionar(destino, cookieApagado(request));
    return Response.json({ ok: true, destino }, { headers: { "Set-Cookie": cookieApagado(request) } });
  },
  { publica: true },
);
