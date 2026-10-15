import { estadoDaMigracao, iniciarMigracao } from "@/features/drive/servicos/videos";
import { route } from "@/lib/server/http";

// Leva para o Google Drive os vídeos que ainda estão no disco do hub: os de antes da conexão e os que ficaram para
// depois porque o Drive falhou na hora. Só quem cuida das Integrações (o card do Google Drive chama estas rotas).
// Resposta das duas: { rodando, total, feitos, falhas, ultimoErro }.

// Como está a migração (a tela consulta enquanto `rodando`).
export const GET = route(async () => Response.json(estadoDaMigracao()), { chave: "integracoes" });

// Começa em segundo plano, um vídeo por vez. Se já está rodando, só devolve o estado (não começa outra).
export const POST = route(async () => Response.json(await iniciarMigracao()), { chave: "integracoes" });
