import { unlink } from "node:fs/promises";
import path from "node:path";

import type { GenerationTool } from "@/lib/generations";
import { InputError, route } from "@/lib/server/http";
import { MEDIA_DIR } from "@/lib/server/media";
import { clearGenerations, listGenerations } from "@/lib/server/store";

// ?tool=<ferramenta> filtra por estúdio; ?saved=1 lista só a Biblioteca.
export const GET = route(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const tool = params.get("tool") as GenerationTool | null;
  let generations = await listGenerations(tool ?? undefined);
  if (params.get("saved") === "1") generations = generations.filter((g) => g.saved);
  return Response.json({ generations });
});

// Botão "Limpar" do estúdio.
export const DELETE = route(async (request: Request) => {
  const tool = new URL(request.url).searchParams.get("tool") as GenerationTool | null;
  if (!tool) throw new InputError("Informe a ferramenta (?tool=).");
  const removed = await clearGenerations(tool);
  await Promise.all(removed.map((g) => (g.file ? unlink(path.join(MEDIA_DIR, g.file)).catch(() => undefined) : undefined)));
  return Response.json({ removed: removed.map((g) => g.id) });
});
