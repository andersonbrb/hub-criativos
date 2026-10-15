import { caminhoSeguro, NaoAutenticado } from "@/features/acesso/contrato";
import { entrar } from "@/features/acesso/servicos/login";
import { cookieDeSessao, exigirMesmoSite, lerCorpo, metaDoPedido, redirecionar } from "@/features/acesso/servicos/pedido";
import { InputError, route } from "@/lib/server/http";

// Login por e-mail e senha. A tela /entrar manda JSON; o formulário puro (sem JavaScript) também funciona e volta
// para /entrar com a mensagem de erro na URL.
export const POST = route(
  async (request: Request) => {
    exigirMesmoSite(request);
    const { dados, formulario } = await lerCorpo(request);
    const proximo = caminhoSeguro(dados.proximo);

    if (!formulario) {
      const { usuario, token } = await entrar(dados.email, dados.senha, metaDoPedido(request));
      return Response.json({ usuario, proximo }, { headers: { "Set-Cookie": cookieDeSessao(request, token) } });
    }

    try {
      const { token } = await entrar(dados.email, dados.senha, metaDoPedido(request));
      return redirecionar(proximo, cookieDeSessao(request, token));
    } catch (err) {
      const erro = err instanceof NaoAutenticado || err instanceof InputError ? err.message : "Não deu para entrar agora. Tente de novo em instantes.";
      if (!(err instanceof NaoAutenticado || err instanceof InputError)) console.error("[hub] entrar:", err instanceof Error ? err.message : err);
      const volta = new URLSearchParams({ proximo, erro, ...(typeof dados.email === "string" ? { email: dados.email.slice(0, 200) } : {}) });
      return redirecionar(`/entrar?${volta}`);
    }
  },
  { publica: true },
);
