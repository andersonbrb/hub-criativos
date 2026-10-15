import { caminhoSeguro } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { ErroNoLoginDoDrive, iniciarLogin, origemPublica } from "@/features/drive/servicos/conta";
import { route } from "@/lib/server/http";

// Botão "Conectar" do card do Google Drive (Integrações): manda a pessoa para a tela de autorização do Google.
// ?volta=/caminho do hub para onde ela volta depois. Se falta algo no servidor, volta para o card com o aviso, em vez
// de abrir uma página de erro em JSON (o botão é um link, não um fetch).
export const GET = route(
  async (request: Request) => {
    const usuario = await exigirUsuario("integracoes");
    const volta = caminhoSeguro(new URL(request.url).searchParams.get("volta"), "/integracoes");
    try {
      return Response.redirect(await iniciarLogin(volta, origemPublica(request), usuario.id), 302);
    } catch (err) {
      console.error("[drive] login:", err instanceof Error ? err.message : err);
      const motivo = err instanceof ErroNoLoginDoDrive ? err.motivo : "erro";
      // Location relativo: atrás do proxy do Railway o host de request.url pode ser o interno.
      return new Response(null, { status: 303, headers: { Location: `/integracoes?drive=erro&motivo=${motivo}` } });
    }
  },
  { chave: "integracoes" },
);
