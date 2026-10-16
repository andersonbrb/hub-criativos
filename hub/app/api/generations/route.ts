import { unlink } from "node:fs/promises";
import path from "node:path";

import { sincronizarComDrive, tirarDoDrive } from "@/features/drive/servicos/videos";
import type { Generation, GenerationTool } from "@/lib/generations";
import { InputError, route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO } from "@/lib/server/media";
import { pastaDeMidia } from "@/lib/server/pastas";
import { clearGenerations, listGenerations } from "@/lib/server/store";

// ?tool=<ferramenta> filtra por estúdio; ?saved=1 lista só a Biblioteca.
// Listam: Biblioteca, Editor, Fluxo e os estúdios. As outras telas de produção mostram as mesmas gerações nos cards.
// Cada lista dispara o espelho do Drive em segundo plano (no máximo 1 vez por minuto): o que foi apagado ou
// renomeado direto no Drive aparece na lista seguinte.
export const GET = route(async (request: Request) => {
  void sincronizarComDrive();
  const params = new URL(request.url).searchParams;
  const tool = params.get("tool") as GenerationTool | null;
  let generations = await listGenerations(tool ?? undefined);
  if (params.get("saved") === "1") generations = generations.filter((g) => g.saved);
  return Response.json({ generations });
}, { chave: CHAVES_DE_PRODUCAO });

// Ferramentas que têm o botão "Limpar" (o histórico de cada estúdio). Uploads, exportações do editor e o resto não
// se apagam em massa por aqui.
const FERRAMENTAS_DOS_ESTUDIOS: GenerationTool[] = ["flora", "elevenlabs", "heygen", "heygen-traducao", "montagem"];

// Vídeos do Drive mandados para a lixeira ao mesmo tempo (o Drive limita pedidos seguidos).
const DE_CADA_VEZ = 8;

// Botão "Limpar" do estúdio: só quem tem os Estúdios. Os vídeos do Drive vão antes para a lixeira de lá; o que o Drive
// recusar continua no estúdio e a tela recebe o erro.
// Os escondidos pelo espelho (`foraDoDrive`) nunca saem por aqui: podem ser de uma conta do Drive que foi trocada e
// voltam quando ela volta. Sem o registro, o vídeo ficaria perdido no Drive.
export const DELETE = route(async (request: Request) => {
  const tool = new URL(request.url).searchParams.get("tool") as GenerationTool | null;
  if (!tool) throw new InputError("Informe a ferramenta (?tool=).");
  if (!FERRAMENTAS_DOS_ESTUDIOS.includes(tool)) throw new InputError(`Só dá para limpar o histórico de um estúdio (${FERRAMENTAS_DOS_ESTUDIOS.join(", ")}).`);

  const candidatas = (await listGenerations(tool)).filter((g) => !g.saved && !g.foraDoDrive && (g.status === "done" || g.status === "failed"));
  const saem: string[] = [];
  let falhas = 0;
  let motivo = "";
  for (let i = 0; i < candidatas.length; i += DE_CADA_VEZ) {
    await Promise.all(
      candidatas.slice(i, i + DE_CADA_VEZ).map(async (g: Generation) => {
        try {
          await tirarDoDrive(g);
          saem.push(g.id);
        } catch (err) {
          falhas++;
          // O motivo do Drive (a mensagem de tirarDoDrive é para um vídeo só).
          const causa = err instanceof Error && err.cause instanceof Error ? err.cause : err;
          motivo = causa instanceof Error ? causa.message : String(causa);
        }
      }),
    );
  }

  const removed = await clearGenerations(tool, { ids: saem });
  const midia = await pastaDeMidia();
  await Promise.all(removed.map((g) => (g.file ? unlink(path.join(midia, g.file)).catch(() => undefined) : undefined)));
  if (falhas) {
    const quantos = falhas === 1 ? "1 vídeo não foi para a lixeira do Google Drive e continua" : `${falhas} vídeos não foram para a lixeira do Google Drive e continuam`;
    throw new Error(`${quantos} no estúdio${removed.length ? " (o resto foi apagado)" : ""}. ${motivo}`);
  }
  return Response.json({ removed: removed.map((g) => g.id) });
}, { chave: "estudios" });
