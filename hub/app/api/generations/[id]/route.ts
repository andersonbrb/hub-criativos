import { unlink } from "node:fs/promises";
import path from "node:path";

import type { Chave } from "@/features/acesso/contrato";
import { InputError, route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO, MEDIA_DIR } from "@/lib/server/media";
import { deleteGeneration, getGeneration, updateGeneration } from "@/lib/server/store";

// Telas com a lixeira que apaga a geração: Biblioteca, estúdios, Editor (exportações), Chat/agentes e Criativo
// automático (cards da conversa). No card do Fluxo a lixeira só tira a geração do card, sem apagar.
const CHAVES_QUE_APAGAM: Chave[] = ["biblioteca", "estudios", "editor", "chat", "criativo-automatico"];

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const gen = await getGeneration(id);
  if (!gen) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
  await deleteGeneration(id);
  if (gen.file) await unlink(path.join(MEDIA_DIR, gen.file)).catch(() => undefined);
  return Response.json({ ok: true });
}, { chave: CHAVES_QUE_APAGAM });

// Salvar ou tirar da Biblioteca: { saved: boolean }. Renomear: { name: string } ("" volta ao nome automático).
// Os dois botões ficam no card de geração, que aparece em todas as telas de produção (inclusive no card do Fluxo).
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { saved?: unknown; name?: unknown };
  const patch: { saved?: boolean; name?: string } = {};
  if (typeof body.saved === "boolean") patch.saved = body.saved;
  if (typeof body.name === "string") patch.name = body.name.replace(/\s+/g, " ").trim().slice(0, 100) || undefined;
  if (!("saved" in patch) && !("name" in patch)) throw new InputError("Envie { saved: true | false } ou { name }.");
  const gen = await updateGeneration(id, patch);
  if (!gen) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
  return Response.json({ generation: gen });
}, { chave: CHAVES_DE_PRODUCAO });
