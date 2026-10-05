import { unlink } from "node:fs/promises";
import path from "node:path";

import { InputError, route } from "@/lib/server/http";
import { MEDIA_DIR } from "@/lib/server/media";
import { deleteGeneration, getGeneration, updateGeneration } from "@/lib/server/store";

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const gen = await getGeneration(id);
  if (!gen) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
  await deleteGeneration(id);
  if (gen.file) await unlink(path.join(MEDIA_DIR, gen.file)).catch(() => undefined);
  return Response.json({ ok: true });
});

// Salvar ou tirar da Biblioteca: { saved: boolean }
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { saved?: unknown };
  if (typeof body.saved !== "boolean") throw new InputError("Envie { saved: true | false }.");
  const gen = await updateGeneration(id, { saved: body.saved });
  if (!gen) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
  return Response.json({ generation: gen });
});
