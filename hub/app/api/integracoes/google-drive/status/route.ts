import { desconectar, oQueFaltaParaConectar, statusDrive } from "@/features/drive/servicos/conta";
import { route } from "@/lib/server/http";

// Situação da conta do Google Drive: configurado, conectado, qual conta e o espaço (StatusDrive), mais `falta`, o
// texto do que falta no servidor para conectar (ou null). Ler basta estar logado: outras telas podem avisar que o
// Drive está desligado. Desconectar só com a chave "integracoes".
const situacao = async () => Response.json({ ...(await statusDrive()), falta: oQueFaltaParaConectar() });

// <[Request]>: as funções não leem o pedido, mas a rota recebe um (e os testes chamam com ele).
export const GET = route<[Request]>(situacao);

// Tira a conta do hub e revoga a autorização no Google. Os vídeos continuam no Drive da conta.
export const DELETE = route<[Request]>(
  async () => {
    await desconectar();
    return situacao();
  },
  { chave: "integracoes" },
);
