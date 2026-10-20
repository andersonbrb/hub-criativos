import { desconectar, oQueFaltaParaConectar, statusYoutube } from "@/features/youtube/servicos/conta";
import { route } from "@/lib/server/http";

// Situação do canal do YouTube da organização aberta (card em Integrações), mais `falta`: o que falta no servidor para
// conectar (ou null). DELETE desconecta: tira o canal do hub, revoga no Google e cancela os envios agendados dele.
const situacao = async () => Response.json({ ...(await statusYoutube()), falta: await oQueFaltaParaConectar() });

export const GET = route<[Request]>(situacao, { chave: "integracoes" });

export const DELETE = route<[Request]>(
  async () => {
    await desconectar();
    return situacao();
  },
  { chave: "integracoes" },
);
