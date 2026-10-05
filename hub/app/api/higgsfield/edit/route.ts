import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runEdit } from "@/lib/server/actions";
import { route } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

// FormData: tool, params (JSON), prompt?, e o vídeo de entrada como `sourceId` (geração do hub) ou `video` (arquivo).
export const POST = route(async (request: Request) => {
  const form = await request.formData();
  const sourceId = String(form.get("sourceId") ?? "");
  const upload = form.get("video");

  let source: { generationId: string } | { path: string; label: string };
  if (sourceId) {
    source = { generationId: sourceId };
  } else if (upload instanceof File && upload.size > 0) {
    const dir = path.join(DATA_DIR, "uploads");
    await mkdir(dir, { recursive: true });
    const ext = upload.name.split(".").pop()?.toLowerCase() || "mp4";
    const videoPath = path.join(dir, `${randomUUID()}.${ext}`);
    await writeFile(videoPath, Buffer.from(await upload.arrayBuffer()));
    source = { path: videoPath, label: upload.name };
  } else {
    return Response.json({ error: "Escolha o vídeo que vai ser editado." }, { status: 400 });
  }

  const generation = await runEdit({
    tool: String(form.get("tool") ?? ""),
    params: JSON.parse(String(form.get("params") ?? "{}")),
    prompt: String(form.get("prompt") ?? ""),
    source,
  });
  return Response.json({ generation });
});
