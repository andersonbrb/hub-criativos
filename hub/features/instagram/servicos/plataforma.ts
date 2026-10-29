import "server-only";

import { SystemClock, UuidGenerator } from "@sbs/shared-kernel";

import { lerChave } from "@/features/integracoes/servicos/chaves";
import { mcp } from "@/lib/server/mcp-client";

import { createContainer, type Container } from "../servidor/composition/container";
import { mediaSecret } from "../servidor/composition/media-storage";
import { buildServer, type Server } from "../servidor/http/server";
import { HubVideoRenderer } from "../servidor/infrastructure/integrations/hub-tools";

// O Instagram dentro do hub (o antigo "San Benito Social", migrado em 29/10/2026): o núcleo de origem
// (features/instagram/nucleo) com o banco, as organizações, as chaves e os logins do hub. Uma instância por processo
// do servidor; cada pedido e cada tarefa rodam na organização de quem pediu (organizacaoAtual).

// Endereço público do hub: base dos links de mídia que o Instagram, a vMake e o HeyGen baixam, e do retorno do
// login do Instagram. No PC sem HUB_PUBLIC_URL, o localhost (os serviços de fora não chegam, mas as telas funcionam).
export const enderecoPublico = () => (process.env.HUB_PUBLIC_URL?.trim() || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");

// Quantos posts recentes da conta de referência cada sincronização lê (o mesmo padrão do projeto de origem).
const POSTS_POR_SINCRONIZACAO = 50;

type Instagram = { container: Container; app: Server };

const g = globalThis as typeof globalThis & { __hubInstagram?: Promise<Instagram> };

// No ar, uma instância só para todas as rotas e a agenda (globalThis). No `next dev`, o código muda sem reiniciar: a
// instância fica neste módulo e é refeita a cada mudança.
let local: Promise<Instagram> | undefined;

export function instagram(): Promise<Instagram> {
  if (process.env.NODE_ENV === "development") return (local ??= montar());
  g.__hubInstagram ??= montar().catch((err) => {
    g.__hubInstagram = undefined;
    throw err;
  });
  return g.__hubInstagram;
}

async function montar(): Promise<Instagram> {
  const publicUrl = enderecoPublico();
  const container = createContainer({
    clock: new SystemClock(),
    ids: new UuidGenerator(),
    logger: { error: (obj, msg) => console.error(`[instagram] ${msg ?? "erro"}`, obj) },
    platform: {
      production: process.env.NODE_ENV === "production",
      referencePostsLimit: POSTS_POR_SINCRONIZACAO,
      integrations: {
        publicUrl,
        hub: {
          key: lerChave,
          mcpActive: async (servico) => {
            const { situacao, account } = await mcp(servico).connectionStatus();
            return { active: situacao === "ativa", account: account?.email ?? account?.name ?? null };
          },
        },
      },
      media: { publicUrl, secret: mediaSecret() },
      videoRenderer: (media) => new HubVideoRenderer(media),
    },
  });
  const app = await buildServer(container);
  return { container, app };
}
