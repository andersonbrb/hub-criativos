import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { criarEnvio, listarEnvios } from "@/features/youtube/servicos/envios";
import { InputError, route } from "@/lib/server/http";

// Envios para o YouTube da organização aberta (chave "youtube").
// GET ?geracao=<id>: os envios daquele vídeo; sem ele, os últimos da organização.
// POST (FormData): geracaoId, titulo, descricao, visibilidade (public|unlisted|private), agendadoPara (ISO; vazio =
// agora), shorts, paraCriancas e miniatura (arquivo JPG/PNG, opcional).

export const GET = route(
  async (request: Request) => {
    const geracao = new URL(request.url).searchParams.get("geracao");
    return Response.json({ envios: await listarEnvios(geracao) });
  },
  { chave: "youtube" },
);

export const POST = route(
  async (request: Request) => {
    const eu = await exigirUsuario("youtube");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new InputError("Pedido de envio inválido. Recarregue a página e tente de novo.");
    }
    const miniatura = form.get("miniatura");
    const envio = await criarEnvio(
      {
        geracaoId: form.get("geracaoId"),
        titulo: form.get("titulo"),
        descricao: form.get("descricao"),
        visibilidade: form.get("visibilidade"),
        agendadoPara: form.get("agendadoPara"),
        shorts: form.get("shorts"),
        paraCriancas: form.get("paraCriancas"),
      },
      miniatura instanceof File ? miniatura : null,
      eu,
    );
    return Response.json({ envio });
  },
  { chave: "youtube" },
);
