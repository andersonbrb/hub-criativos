import type { Chave } from "@/features/acesso/contrato";
import { exigirDriveParaVideo, guardarNoDriveEmSegundoPlano, prazoNoHub } from "@/features/drive/servicos/videos";
import { route } from "@/lib/server/http";
import { saveUploadedMedia } from "@/lib/server/media";
import { createGeneration } from "@/lib/server/store";

// Envio de um arquivo do computador para o hub (ex.: vídeo para o editor).
// FormData: file. Vira uma geração "upload", que pode ser aberta no editor, editada, montada etc.
// O arquivo vai em pedaços direto para o disco (saveUploadedMedia), sem passar inteiro pela memória.
// Vídeo (regra do dono): só com o Google Drive conectado, e logo depois sobe para a pasta "Enviados pela equipe" de
// lá; a cópia do hub sai assim que o Drive confirma.

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

// Telas com botão de enviar arquivo: Editor (vídeos), card do Fluxo (anexos) e estúdio de Tradução (vídeos).
// O chat anexa pela própria rota (/api/chat).
const CHAVES_DE_ENVIO: Chave[] = ["editor", "fluxo", "estudios"];

export const POST = route(async (request: Request) => {
  const envio = await saveUploadedMedia(request, {
    campo: "file",
    tetoBytes: MAX_BYTES,
    antesDeGravar: async (kind) => {
      if (kind === "video") await exigirDriveParaVideo();
    },
  });
  const generation = await createGeneration({
    tool: "upload",
    kind: envio.kind,
    status: "done",
    prompt: envio.name || "arquivo enviado",
    file: envio.file,
    params: envio.kind === "video" ? { prazoNoHub: prazoNoHub() } : {},
  });
  guardarNoDriveEmSegundoPlano(generation);
  return Response.json({ generation });
}, { chave: CHAVES_DE_ENVIO });
