import "server-only";

import { requireKey } from "@/lib/server/env";
import { ProviderError } from "@/lib/server/http";

// FLORA REST API (developer.flora.ai). Auth: Authorization: Bearer ak_…
const BASE = "https://app.flora.ai/api/v1";
const PROJECT_NAME = "Hub de Criativos";

async function call<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireKey("flora")}`,
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError("FLORA", res.status, text);
  return JSON.parse(text) as T;
}

// Workspace e projeto onde as gerações do hub ficam no canvas do FLORA.
let target: Promise<{ workspaceId: string; projectId: string }> | null = null;

export function getTarget() {
  target ??= (async () => {
    let workspaceId = process.env.FLORA_WORKSPACE_ID?.trim();
    if (!workspaceId) {
      const { workspaces } = await call<{ workspaces: { workspace_id: string }[] }>("/workspaces");
      if (!workspaces.length) throw new Error("A chave do FLORA não tem acesso a nenhum workspace.");
      workspaceId = workspaces[0].workspace_id;
    }
    let projectId = process.env.FLORA_PROJECT_ID?.trim();
    if (!projectId) {
      const qs = new URLSearchParams({ workspace_id: workspaceId, query: PROJECT_NAME, limit: "20" });
      const { projects } = await call<{ projects: { project_id: string; name: string }[] }>(`/projects?${qs}`);
      projectId =
        projects.find((p) => p.name === PROJECT_NAME)?.project_id ??
        (
          await call<{ project_id: string }>("/projects", {
            method: "POST",
            body: JSON.stringify({ workspace_id: workspaceId, name: PROJECT_NAME }),
          })
        ).project_id;
    }
    return { workspaceId, projectId };
  })().catch((err) => {
    target = null; // tenta de novo na próxima chamada
    throw err;
  });
  return target;
}

// Projeto escolhido na conversa (flora_projects) ou o padrão "Hub de Criativos" dos estúdios.
async function targetFor(projectId?: string | null) {
  const ids = await getTarget();
  return projectId ? { ...ids, projectId } : ids;
}

export type FloraProject = { id: string; name: string; lastModified: number | null };

export async function listProjects(): Promise<FloraProject[]> {
  const { workspaceId } = await getTarget();
  const out: FloraProject[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ workspace_id: workspaceId, limit: "100", ...(cursor ? { cursor } : {}) });
    const data = await call<{ projects: { project_id: string; name: string; last_modified?: number }[]; meta?: { next_cursor?: string | null } }>(`/projects?${qs}`);
    out.push(...data.projects.map((p) => ({ id: p.project_id, name: p.name, lastModified: p.last_modified ?? null })));
    cursor = data.meta?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

export async function createProject(name: string): Promise<FloraProject> {
  const { workspaceId } = await getTarget();
  const p = await call<{ project_id: string; name?: string }>("/projects", { method: "POST", body: JSON.stringify({ workspace_id: workspaceId, name }) });
  return { id: p.project_id, name: p.name ?? name, lastModified: Date.now() };
}

// Mídia que está no canvas de um projeto (a API não devolve o prompt, só o arquivo).
export type FloraNode = { nodeId: string; type: "image" | "video"; assetId: string | null; url: string };

export async function listProjectMedia(projectId: string): Promise<FloraNode[]> {
  const out: FloraNode[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
    const data = await call<{ nodes: { node_id: string; type: string; asset_id?: string; url?: string }[]; meta?: { next_cursor?: string | null } }>(
      `/projects/${encodeURIComponent(projectId)}/nodes?${qs}`,
    );
    for (const n of data.nodes) {
      if ((n.type === "image" || n.type === "video") && n.url) out.push({ nodeId: n.node_id, type: n.type, assetId: n.asset_id ?? null, url: n.url });
    }
    cursor = data.meta?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

// fresh: nó criado agora pelo upload (o organizador pode posicioná-lo junto das gerações).
export type FloraReference = { nodeId: string | null; url: string; fresh?: boolean };

// Sobe uma imagem (foto do produto, frame…) e coloca no canvas do projeto.
// Devolve a URL (vai em params.image_url) e o node_id do canvas (vai em reference_node_ids nos frames).
export async function uploadReference(file: File, project?: string | null): Promise<FloraReference> {
  if (file.size > 4 * 1024 * 1024) throw new Error("A imagem de referência precisa ter até 4 MB.");
  const { workspaceId, projectId } = await targetFor(project);
  const form = new FormData();
  form.set("workspace_id", workspaceId);
  form.set("file", file, file.name);
  const asset = await call<{ asset_id?: string; id?: string; url?: string }>("/assets", { method: "POST", body: form });
  const assetId = asset.asset_id ?? asset.id;
  if (!assetId) throw new Error("FLORA não devolveu o id da imagem enviada.");

  let url = asset.url;
  if (!url) url = (await call<{ url?: string }>(`/assets/${encodeURIComponent(assetId)}`)).url;
  if (!url) throw new Error("FLORA não devolveu a URL da imagem enviada.");

  const attached = await call<{ node_id?: string }>(
    `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/attach`,
    { method: "POST" },
  ).catch(() => ({ node_id: undefined })); // sem nó no canvas o frame ainda funciona via image_url
  return { nodeId: attached.node_id ?? null, url, fresh: true };
}

export type FloraGenerateInput = {
  type: "image" | "video";
  prompt: string;
  model: string;
  params: Record<string, string>;
  // Imagens de referência: uma vai em image_url (ou image_urls, no Gemini Omni); várias, sempre em image_urls.
  references?: FloraReference[];
  imageField?: "image_url" | "image_urls";
  projectId?: string | null;
};

function body(input: FloraGenerateInput, ids: { workspaceId: string; projectId: string }, quote = false) {
  const params: Record<string, string | string[]> = { ...input.params };
  const refs = input.references ?? [];
  if (refs.length > 1 || (refs.length === 1 && input.imageField === "image_urls")) params.image_urls = refs.map((r) => r.url);
  else if (refs.length === 1) params.image_url = refs[0].url;
  // Com uma referência, o frame também liga o nó do produto no canvas (em vídeo reference_node_ids dá erro 400).
  // Com várias, as imagens já vão em image_urls; as setas no canvas ficam por conta do organizeCanvas.
  const nodeRefs = input.type === "image" && refs.length === 1 && refs[0].nodeId ? [refs[0].nodeId] : [];
  return JSON.stringify({
    type: input.type,
    prompt: input.prompt,
    workspace_id: ids.workspaceId,
    project_id: ids.projectId,
    model: input.model,
    params,
    ...(nodeRefs.length ? { reference_node_ids: nodeRefs } : {}),
    ...(quote ? { quote: true } : {}),
  });
}

export async function quote(input: FloraGenerateInput): Promise<number | null> {
  const ids = await targetFor(input.projectId);
  const q = await call<{ estimated_cost?: number }>("/generate", { method: "POST", body: body(input, ids, true) });
  return q.estimated_cost ?? null;
}

export async function generate(input: FloraGenerateInput) {
  const ids = await targetFor(input.projectId);
  return call<{ run_id: string; node_id: string; charged_cost?: number; estimated_seconds?: number }>("/generate", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: body(input, ids),
  });
}

export type FloraRun = {
  status: "pending" | "running" | "completed" | "failed";
  outputs?: { type: string; url: string }[];
  error_message?: string | null;
  charged_cost?: number;
};

export function getRun(runId: string) {
  return call<FloraRun>(`/runs/${encodeURIComponent(runId)}`);
}

// ---------- Organização do canvas ----------
// Cada envio vira uma fileira nova abaixo do que já existe no canvas: a referência (quando foi enviada agora)
// na primeira coluna, as variações ao lado, todas com nome, e a referência ligada a cada uma por uma seta.

type GraphNode = { id: string; node_id: string; type: string; position?: { x: number; y: number }; size?: { width: number; height: number } | null };
type Graph = { nodes: GraphNode[]; edges: { from: string; to: string }[] };

const ROW_GAP = 160;
const COL_GAP = 60;
const DEFAULT_SIZE = { width: 320, height: 420 };

export async function organizeCanvas(input: {
  projectId: string;
  nodeIds: string[];
  labels: string[];
  references?: FloraReference[];
  referenceLabels?: string[];
}) {
  const { workspaceId } = await getTarget();
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(input.projectId)}`;
  const graph = await call<Graph>(`${base}/graph`);
  const find = (id: string | null | undefined) => (id ? graph.nodes.find((n) => n.node_id === id || n.id === id) : undefined);

  const batch = input.nodeIds.map((id, i) => ({ node: find(id), label: input.labels[i] })).filter((b): b is { node: GraphNode; label: string } => Boolean(b.node));
  if (!batch.length) return;
  // Referências no canvas; as enviadas agora entram na fileira, antes das variações.
  const refs = (input.references ?? [])
    .map((r, i) => ({ node: find(r.nodeId), fresh: Boolean(r.fresh), label: input.referenceLabels?.[i] }))
    .filter((r): r is { node: GraphNode; fresh: boolean; label: string | undefined } => Boolean(r.node));
  const moved = refs.filter((r) => r.fresh);

  const moving = new Set([...batch.map((b) => b.node.id), ...moved.map((r) => r.node.id)]);
  const others = graph.nodes.filter((n) => !moving.has(n.id) && n.position);
  const size = (n: GraphNode) => n.size ?? DEFAULT_SIZE;
  const top = others.length ? Math.max(...others.map((n) => n.position!.y + size(n).height)) + ROW_GAP : 0;
  const left = others.length ? Math.min(...others.map((n) => n.position!.x)) : 0;
  const step = Math.max(...batch.map((b) => size(b.node).width), DEFAULT_SIZE.width) + COL_GAP;

  const update: { id: string; label?: string; position: { x: number; y: number } }[] = [];
  let x = left;
  for (const r of moved) {
    update.push({ id: r.node.id, ...(r.label ? { label: r.label } : {}), position: { x, y: top } });
    x += size(r.node).width + COL_GAP;
  }
  for (const b of batch) {
    update.push({ id: b.node.id, label: b.label, position: { x, y: top } });
    x += step;
  }
  const connect = refs.flatMap((r) =>
    batch.filter((b) => !graph.edges.some((e) => e.from === r.node.id && e.to === b.node.id)).map((b) => ({ from: r.node.id, to: b.node.id })),
  );

  const apply = (changes: object) => call(`${base}/canvas/changeset`, { method: "POST", body: JSON.stringify(changes) });
  try {
    await apply({ update, ...(connect.length ? { connect } : {}) });
  } catch (err) {
    // Algum modelo pode recusar a seta da referência; nome e posição continuam valendo.
    if (!connect.length) throw err;
    await apply({ update });
  }
}
