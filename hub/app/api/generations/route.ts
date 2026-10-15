import { unlink } from "node:fs/promises";
import path from "node:path";

import type { GenerationTool } from "@/lib/generations";
import { InputError, route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO, MEDIA_DIR } from "@/lib/server/media";
import { clearGenerations, listGenerations } from "@/lib/server/store";

// ?tool=<ferramenta> filtra por estúdio; ?saved=1 lista só a Biblioteca.
// Listam: Biblioteca, Editor, Fluxo e os estúdios. As outras telas de produção mostram as mesmas gerações nos cards.
export const GET = route(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const tool = params.get("tool") as GenerationTool | null;
  let generations = await listGenerations(tool ?? undefined);
  if (params.get("saved") === "1") generations = generations.filter((g) => g.saved);
  return Response.json({ generations });
}, { chave: CHAVES_DE_PRODUCAO });

// Ferramentas que têm o botão "Limpar" (o histórico de cada estúdio). Uploads, exportações do editor e o resto não
// se apagam em massa por aqui.
const FERRAMENTAS_DOS_ESTUDIOS: GenerationTool[] = ["flora", "elevenlabs", "heygen", "heygen-traducao", "montagem"];

// Botão "Limpar" do estúdio: só quem tem os Estúdios.
export const DELETE = route(async (request: Request) => {
  const tool = new URL(request.url).searchParams.get("tool") as GenerationTool | null;
  if (!tool) throw new InputError("Informe a ferramenta (?tool=).");
  if (!FERRAMENTAS_DOS_ESTUDIOS.includes(tool)) throw new InputError(`Só dá para limpar o histórico de um estúdio (${FERRAMENTAS_DOS_ESTUDIOS.join(", ")}).`);
  const removed = await clearGenerations(tool);
  await Promise.all(removed.map((g) => (g.file ? unlink(path.join(MEDIA_DIR, g.file)).catch(() => undefined) : undefined)));
  return Response.json({ removed: removed.map((g) => g.id) });
}, { chave: "estudios" });
