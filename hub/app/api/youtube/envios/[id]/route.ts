import { cancelarEnvio, tentarDeNovo } from "@/features/youtube/servicos/envios";
import { route } from "@/lib/server/http";

// Um envio para o YouTube da organização aberta (chave "youtube"). O id de outra organização dá "não encontrado".
// DELETE: cancela (agendado ou ainda subindo). POST: tenta de novo um envio que falhou.

type Contexto = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request: Request, { params }: Contexto) => Response.json({ envio: await cancelarEnvio((await params).id) }), {
  chave: "youtube",
});

export const POST = route(async (_request: Request, { params }: Contexto) => Response.json({ envio: await tentarDeNovo((await params).id) }), {
  chave: "youtube",
});
