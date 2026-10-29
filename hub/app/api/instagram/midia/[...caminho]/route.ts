import { instagram } from "@/features/instagram/servicos/plataforma";

// Link permanente e público de um arquivo do Instagram (cópia do post, vídeo sem legenda, traduzido, editado, imagens
// adaptadas). Sem login: é o link que o Instagram, a vMake, o HeyGen e o FLORA baixam. A assinatura do link (HMAC)
// é a proteção, e o arquivo vem da organização do link (features/instagram/servidor/composition/media-storage.ts).

async function servir(request: Request) {
  const { container } = await instagram();
  return container.media.serve(request, request.url);
}

export const GET = servir;
export const HEAD = servir;
