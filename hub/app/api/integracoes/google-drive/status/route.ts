import { desconectar, oQueFaltaParaConectar, statusDrive } from "@/features/drive/servicos/conta";
import { videosNaFila } from "@/features/drive/servicos/videos";
import { route } from "@/lib/server/http";

// Situação da conta do Google Drive: configurado, conectado, qual conta e o espaço (StatusDrive), mais `falta`, o
// texto do que falta no servidor para conectar (ou null). Tudo só com a chave "integracoes": quem lê é o card do
// Drive, na tela Integrações.
const situacao = async () => Response.json({ ...(await statusDrive()), falta: oQueFaltaParaConectar() });

// <[Request]>: as funções não leem o pedido, mas a rota recebe um (e os testes chamam com ele).
// O GET diz também quantos vídeos ainda estão no disco do hub esperando para ir ao Drive (`naFila`).
export const GET = route<[Request]>(
  async () => Response.json({ ...(await statusDrive()), falta: oQueFaltaParaConectar(), naFila: await videosNaFila() }),
  { chave: "integracoes" },
);

// Tira a conta do hub e revoga a autorização no Google. Os vídeos continuam no Drive da conta.
export const DELETE = route<[Request]>(
  async () => {
    await desconectar();
    return situacao();
  },
  { chave: "integracoes" },
);
