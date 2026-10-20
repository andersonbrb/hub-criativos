import { caminhoSeguro } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { ErroNoLoginDoYoutube, iniciarLogin, origemPublica } from "@/features/youtube/servicos/conta";
import { route } from "@/lib/server/http";

// Botão "Conectar YouTube" do card (Integrações): manda a pessoa para a tela do Google, onde ela escolhe a conta e o
// canal. Se falta algo no servidor, volta para o card com o aviso (o botão é um link, não um fetch).
export const GET = route(
  async (request: Request) => {
    const usuario = await exigirUsuario("integracoes");
    const volta = caminhoSeguro(new URL(request.url).searchParams.get("volta"), "/integracoes");
    try {
      return Response.redirect(await iniciarLogin(volta, origemPublica(request), usuario.id), 302);
    } catch (err) {
      console.error("[youtube] login:", err instanceof Error ? err.message : err);
      const motivo = err instanceof ErroNoLoginDoYoutube ? err.motivo : "erro";
      return new Response(null, { status: 303, headers: { Location: `/integracoes?youtube=erro&motivo=${motivo}` } });
    }
  },
  { chave: "integracoes" },
);
