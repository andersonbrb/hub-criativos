import "server-only";

import { createHash } from "node:crypto";

import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { mcp } from "@/lib/server/mcp-client";

// FLORA pelo MCP remoto (agents.flora.ai/mcp) com o login OAuth da conta (Integrações → FLORA).
// O cliente genérico (login, tokens, protocolo) fica em lib/server/mcp-client.ts; aqui só o que é do FLORA.
const flora = mcp("flora");
const PROJECT_NAME = "Hub de Criativos";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (...vals: unknown[]) => vals.find((v): v is string => typeof v === "string" && v.length > 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// O MCP às vezes manda o JSON como texto com um aviso depois ("Usage amounts: …"): pega só o primeiro objeto.
function firstJson(text: string): unknown {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function tool(name: string, args: Rec = {}): Promise<Rec> {
  let out = rec(await flora.callTool<Rec>(name, args));
  const keys = Object.keys(out);
  if (keys.length === 1 && typeof out.text === "string") out = rec(firstJson(out.text));
  return { ...rec(out.data), ...rec(out.result), ...out };
}

const list = (o: Rec, ...keys: string[]): Rec[] => {
  for (const k of [...keys, "items", "data", "results"]) if (Array.isArray(o[k])) return (o[k] as unknown[]).map(rec);
  return [];
};

// As ferramentas do MCP só aceitam o id do projeto com o prefixo prj_.
const pid = (id: string) => (id.startsWith("prj_") ? id : `prj_${id}`);

// ---------- Workspace e projeto ----------
// Onde as gerações do hub ficam no canvas do FLORA. FLORA_WORKSPACE_ID / FLORA_PROJECT_ID (.env.local) mandam quando
// existem. Sem elas, a conta do MCP pode ter vários workspaces (o próprio e os de quem a convidou): o padrão é o
// workspace que já tem o projeto "Hub de Criativos" (procurado em todos; os projetos antigos do hub ficam no workspace
// cuja chave de API o hub usava), senão o current_workspace_id, senão o primeiro. Gerar num projeto pede o workspace
// dele, então cada projeto escolhido na conversa resolve o próprio workspace (flora_get_project).

// Cada organização tem a própria conta do FLORA (e o próprio projeto "Hub de Criativos"): um alvo por organização.
// FLORA_WORKSPACE_ID e FLORA_PROJECT_ID valem só para a organização padrão.
type Target = { workspaceId: string; projectId: string };
const targets = new Map<string, Promise<Target>>();
const workspaceOf = new Map<string, string>();

export type FloraProject = { id: string; name: string; lastModified: number | null };
type Found = FloraProject & { workspaceId: string | null };

function toProject(p: Rec): Found | null {
  const id = str(p.project_id, p.id);
  if (!id) return null;
  const workspaceId = str(p.workspace_id) ?? null;
  if (workspaceId) workspaceOf.set(id, workspaceId);
  return { id, name: str(p.name) ?? id, lastModified: typeof p.last_modified === "number" ? p.last_modified : null, workspaceId };
}
const plain = (p: Found): FloraProject => ({ id: p.id, name: p.name, lastModified: p.lastModified });

async function projectWorkspace(projectId: string): Promise<string | null> {
  const known = workspaceOf.get(projectId);
  if (known) return known;
  const o = await tool("flora_get_project", { project_id: pid(projectId) });
  const ws = str(o.workspace_id, rec(o.project).workspace_id) ?? null;
  if (ws) workspaceOf.set(projectId, ws);
  return ws;
}

async function findProject(workspaceId: string, name: string): Promise<Found | null> {
  // Sem visibility vêm os projetos da própria conta; com "workspace", os compartilhados com o workspace.
  for (const visibility of [null, "workspace"]) {
    const o = await tool("flora_list_projects", { workspace_id: workspaceId, query: name, limit: 20, ...(visibility ? { visibility } : {}) });
    const p = list(o, "projects")
      .map(toProject)
      .find((x) => x?.name === name);
    if (p) return { ...p, workspaceId };
  }
  return null;
}

async function createProjectIn(workspaceId: string, name: string): Promise<Found> {
  const o = await tool("flora_create_project", { workspace_id: workspaceId, name });
  const p = toProject({ ...rec(o.project), ...o });
  if (!p) throw new Error("FLORA não devolveu o id do projeto criado.");
  workspaceOf.set(p.id, workspaceId);
  return { ...p, name: p.name === p.id ? name : p.name, lastModified: p.lastModified ?? Date.now(), workspaceId };
}

export async function getTarget(): Promise<Target> {
  const org = await organizacaoAtual();
  const pronto = targets.get(org);
  if (pronto) return pronto;
  const padrao = org === ORGANIZACAO_PADRAO.id;
  const target = (async (): Promise<Target> => {
    const envWorkspace = padrao ? process.env.FLORA_WORKSPACE_ID?.trim() : undefined;
    const envProject = padrao ? process.env.FLORA_PROJECT_ID?.trim() : undefined;
    if (envProject) {
      const workspaceId = envWorkspace || (await projectWorkspace(envProject));
      if (!workspaceId) throw new Error("Não achei o workspace do projeto FLORA_PROJECT_ID.");
      workspaceOf.set(envProject, workspaceId);
      return { workspaceId, projectId: envProject };
    }
    let workspaceId = envWorkspace;
    let found: Found | null = null;
    if (workspaceId) {
      found = await findProject(workspaceId, PROJECT_NAME);
    } else {
      const o = await tool("flora_list_workspaces");
      const ids = list(o, "workspaces")
        .map((w) => str(w.workspace_id, w.id))
        .filter((id): id is string => Boolean(id));
      if (!ids.length) throw new Error("A conta do FLORA não tem acesso a nenhum workspace.");
      for (const ws of ids) {
        found = await findProject(ws, PROJECT_NAME);
        if (found) {
          workspaceId = ws;
          break;
        }
      }
      const current = str(o.current_workspace_id);
      workspaceId ??= current && ids.includes(current) ? current : ids[0];
    }
    const projectId = (found ?? (await createProjectIn(workspaceId, PROJECT_NAME))).id;
    workspaceOf.set(projectId, workspaceId);
    return { workspaceId, projectId };
  })().catch((err) => {
    targets.delete(org); // tenta de novo na próxima chamada
    throw err;
  });
  targets.set(org, target);
  return target;
}

// Projeto escolhido na conversa (flora_projects) ou o padrão "Hub de Criativos" dos estúdios.
async function targetFor(projectId?: string | null): Promise<Target> {
  const ids = await getTarget();
  if (!projectId || projectId === ids.projectId) return ids;
  const workspaceId = (await projectWorkspace(projectId).catch(() => null)) ?? ids.workspaceId;
  return { workspaceId, projectId };
}

async function pages(name: string, args: Rec, key: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const o = await tool(name, { ...args, limit: 100, ...(cursor ? { cursor } : {}) });
    out.push(...list(o, key));
    cursor = str(rec(o.meta).next_cursor, o.next_cursor) ?? "";
    if (!cursor) break;
  }
  return out;
}

export async function listProjects(): Promise<FloraProject[]> {
  const { workspaceId } = await getTarget();
  const own = await pages("flora_list_projects", { workspace_id: workspaceId }, "projects");
  const shared = await pages("flora_list_projects", { workspace_id: workspaceId, visibility: "workspace" }, "projects").catch(() => []);
  const byId = new Map<string, FloraProject>();
  for (const p of [...own, ...shared].map(toProject)) if (p && !byId.has(p.id)) byId.set(p.id, plain(p));
  return [...byId.values()].sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
}

// Um projeto pelo id, mesmo fora do workspace padrão (null quando não existe ou a conta não vê).
export async function getProject(projectId: string): Promise<FloraProject | null> {
  try {
    const o = await tool("flora_get_project", { project_id: pid(projectId) });
    const p = toProject({ ...rec(o.project), ...o });
    return p ? plain(p) : null;
  } catch {
    return null;
  }
}

export async function createProject(name: string): Promise<FloraProject> {
  const { workspaceId } = await getTarget();
  return plain(await createProjectIn(workspaceId, name));
}

// Mídia que está no canvas de um projeto (a lista não devolve o prompt, só o arquivo).
export type FloraNode = { nodeId: string; type: "image" | "video"; assetId: string | null; url: string };

export async function listProjectMedia(projectId: string): Promise<FloraNode[]> {
  const out: FloraNode[] = [];
  for (const n of await pages("flora_list_canvas_nodes", { project_id: pid(projectId) }, "nodes")) {
    const nodeId = str(n.node_id, n.id);
    const url = str(n.url, n.output_url);
    if ((n.type === "image" || n.type === "video") && nodeId && url) out.push({ nodeId, type: n.type, assetId: str(n.asset_id) ?? null, url });
  }
  return out;
}

// ---------- Imagens de referência ----------

// fresh: nó criado agora pelo upload (o organizador pode posicioná-lo junto das gerações).
export type FloraReference = { nodeId: string | null; url: string; fresh?: boolean };

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

const assetUrl = (o: Rec) => str(o.url, o.asset_url, o.public_url, rec(o.asset).url);
const assetStatus = (o: Rec) => str(o.status, rec(o.asset).status)?.toLowerCase();

// Upload assinado do MCP: reserva (flora_create_asset), POST multipart direto ao storage, flora_complete_asset.
async function uploadAsset(bytes: ArrayBuffer, name: string, type: string, workspaceId: string) {
  const o = await tool("flora_create_asset", { workspace_id: workspaceId, source: "signed-url", file_name: name, content_type: type });
  const a = { ...rec(o.asset), ...o };
  const assetId = str(a.asset_id, a.id);
  const up = rec(a.upload);
  const url = str(up.url, up.upload_url);
  if (!assetId || !url) throw new Error("FLORA não devolveu para onde enviar a imagem.");

  // Cada campo de upload.form_fields do jeito que veio, e o arquivo por último em upload.file_field.
  const form = new FormData();
  if (Array.isArray(up.form_fields)) {
    for (const f of up.form_fields.map(rec)) {
      const key = str(f.name, f.key);
      if (key) form.append(key, String(f.value ?? ""));
    }
  } else {
    for (const [k, v] of Object.entries(rec(up.form_fields))) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  form.append(str(up.file_field) ?? "file", new File([bytes], name, { type }));
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Falhou o envio da imagem ao FLORA (${res.status}).`);

  let info = await tool("flora_complete_asset", { asset_id: assetId });
  for (let i = 0; i < 10; i++) {
    const status = assetStatus(info);
    if (status === "failed") throw new Error(`FLORA recusou a imagem: ${str(info.failure_message, rec(info.asset).failure_message) ?? "falhou"}`);
    if (assetUrl(info) && (!status || status === "ready")) break;
    await sleep(1500);
    info = await tool("flora_get_asset", { asset_id: assetId });
  }
  const finalUrl = assetUrl(info);
  if (!finalUrl) throw new Error("FLORA não devolveu a URL da imagem enviada.");
  return { id: assetId, url: finalUrl };
}

// Coloca o asset no canvas. O nó de um asset anexado tem o id "api_<asset_id>" quando a resposta não traz o node_id.
async function attach(assetId: string, projectId: string): Promise<string> {
  const o = await tool("flora_attach_asset", { asset_id: assetId, project_id: pid(projectId) });
  const n = { ...rec(o.node), ...o };
  return str(n.node_id, n.short_id) ?? `api_${assetId}`;
}

// Sobe uma imagem (foto do produto, frame…) e coloca no canvas do projeto.
// Devolve a URL (vai em params.image_url) e o node_id do canvas (vai em reference_node_ids nos frames).
// O mesmo arquivo não sobe duas vezes no mesmo workspace: o asset fica no cache do cliente MCP e só ganha um nó novo.
export async function uploadReference(file: File, project?: string | null): Promise<FloraReference> {
  if (file.size > 4 * 1024 * 1024) throw new Error("A imagem de referência precisa ter até 4 MB.");
  const { workspaceId, projectId } = await targetFor(project);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = file.type && Object.values(IMAGE_TYPES).includes(file.type) ? file.type : (IMAGE_TYPES[ext] ?? "image/png");
  const bytes = await file.arrayBuffer();
  const key = `ref:${workspaceId}:${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}`;

  try {
    const cached = JSON.parse((await flora.cachedAsset(key)) ?? "null") as { id: string; url: string } | null;
    if (cached?.id && cached.url) return { nodeId: await attach(cached.id, projectId), url: cached.url, fresh: true };
  } catch {} // asset apagado no FLORA: sobe de novo

  const asset = await uploadAsset(bytes, file.name || `referencia.${ext || "png"}`, type, workspaceId);
  await flora.rememberAsset(key, JSON.stringify(asset));
  const nodeId = await attach(asset.id, projectId).catch(() => null); // sem nó no canvas o frame ainda funciona via image_url
  return { nodeId, url: asset.url, fresh: true };
}

// ---------- Gerações ----------

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

function request(input: FloraGenerateInput, ids: Target) {
  const params: Record<string, string | string[]> = { ...input.params };
  const refs = input.references ?? [];
  if (refs.length > 1 || (refs.length === 1 && input.imageField === "image_urls")) params.image_urls = refs.map((r) => r.url);
  else if (refs.length === 1) params.image_url = refs[0].url;
  // Com uma referência, o frame também liga o nó do produto no canvas (em vídeo reference_node_ids é recusado).
  // Com várias, as imagens já vão em image_urls; as setas no canvas ficam por conta do organizeCanvas.
  const nodeRefs = input.type === "image" && refs.length === 1 && refs[0].nodeId ? [refs[0].nodeId] : [];
  return {
    workspace_id: ids.workspaceId,
    project_id: pid(ids.projectId),
    type: input.type,
    prompt: input.prompt,
    model: input.model,
    params,
    ...(nodeRefs.length ? { reference_node_ids: nodeRefs } : {}),
  };
}

// Uma geração por chamada (lista de 1 item); erro do item vira erro aqui.
async function createOne(input: FloraGenerateInput, quote: boolean): Promise<Rec> {
  const ids = await targetFor(input.projectId);
  const o = await tool("flora_create_generations", { generations: [request(input, ids)], ...(quote ? { quote: true } : {}) });
  const item = list(o, "generations")[0] ?? o;
  if (item.ok === false || (!quote && !str(item.run_id))) {
    const err = item.error;
    throw new Error(`FLORA: ${str(err, rec(err).message, rec(err).code) ?? JSON.stringify(err ?? item).slice(0, 300)}`);
  }
  return item;
}

export async function quote(input: FloraGenerateInput): Promise<number | null> {
  const q = await createOne(input, true);
  return typeof q.estimated_cost === "number" ? q.estimated_cost : null;
}

export async function generate(input: FloraGenerateInput) {
  const r = await createOne(input, false);
  return {
    run_id: str(r.run_id)!,
    node_id: str(r.node_id, rec(r.node).node_id) ?? "",
    ...(typeof r.charged_cost === "number" ? { charged_cost: r.charged_cost } : {}),
    ...(typeof r.estimated_seconds === "number" ? { estimated_seconds: r.estimated_seconds } : {}),
  };
}

export type FloraRun = {
  status: "pending" | "running" | "completed" | "failed";
  outputs?: { type: string; url: string }[];
  error_message?: string | null;
  charged_cost?: number;
};

function outputType(type: unknown, url: string) {
  const t = String(type ?? "");
  if (t === "videoUrl" || t === "imageUrl") return t;
  if (/video/i.test(t) || /\.(mp4|webm|mov)(\?|$)/i.test(url)) return "videoUrl";
  if (/image/i.test(t) || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)) return "imageUrl";
  return t;
}

function toRun(r: Rec): FloraRun {
  const s = String(r.status ?? "").toLowerCase();
  const status: FloraRun["status"] = ["completed", "succeeded", "success", "done"].includes(s)
    ? "completed"
    : ["failed", "error", "cancelled", "canceled"].includes(s)
      ? "failed"
      : ["pending", "queued"].includes(s)
        ? "pending"
        : "running";
  const outputs = (Array.isArray(r.outputs) ? r.outputs : [])
    .map(rec)
    .map((o) => ({ url: str(o.url) ?? "", type: o.type }))
    .filter((o) => o.url)
    .map((o) => ({ type: outputType(o.type, o.url), url: o.url }));
  const err = r.error_message ?? r.error;
  return {
    status,
    outputs,
    error_message: str(err, rec(err).message) ?? null,
    ...(typeof r.charged_cost === "number" ? { charged_cost: r.charged_cost } : {}),
  };
}

// O MCP limita a leitura de runs (mesmo run no máximo a cada ~15 s; mais rápido volta cooldown/429). Os estúdios
// consultam a cada 6 s e o chat a cada 8 s: as leituras do mesmo instante viram uma chamada só, e cada run fica
// guardado 15 s. Cooldown ou limite não é falha: devolve o último estado conhecido.
const POLL_GAP = 15_000;
// O lote é de uma organização só: a leitura vai pela conta do FLORA dela, que não enxerga os runs das outras.
const runs = new Map<string, { at: number; run: FloraRun }>();
const batches = new Map<string, { ids: Set<string>; done: Promise<void> }>();

const transient = (msg: string) => /cooldown|retry_after|rate.?limit|too many|429/i.test(msg);

function keep(id: string, at: number) {
  runs.set(id, { at, run: runs.get(id)?.run ?? { status: "running" } });
}

async function readRuns(runId: string): Promise<void> {
  const org = await organizacaoAtual();
  const batch = batches.get(org);
  if (batch && batch.ids.size < 20) {
    batch.ids.add(runId);
    return batch.done;
  }
  const ids = new Set([runId]);
  const done = sleep(50).then(async () => {
    if (batches.get(org)?.ids === ids) batches.delete(org);
    const at = Date.now();
    try {
      const o = await tool("flora_list_generations", { run_ids: [...ids] });
      for (const r of list(o, "runs", "generations")) {
        const id = str(r.run_id, r.id, r.generation_id);
        if (!id || !ids.has(id)) continue;
        if (r.ok === false) {
          const msg = str(r.error, rec(r.error).message) ?? "";
          if (r.status === 404 || /not.?found/i.test(msg)) runs.set(id, { at, run: { status: "failed", error_message: `FLORA: ${msg || "geração não encontrada"}` } });
          else keep(id, at);
        } else runs.set(id, { at, run: toRun(r) });
      }
      for (const id of ids) if (runs.get(id)?.at !== at) keep(id, at);
    } catch (err) {
      if (!transient(err instanceof Error ? err.message : String(err))) throw err;
      for (const id of ids) keep(id, at);
    }
  });
  batches.set(org, { ids, done });
  return done;
}

export async function getRun(runId: string): Promise<FloraRun> {
  const hit = runs.get(runId);
  if (hit && (hit.run.status === "completed" || hit.run.status === "failed" || Date.now() - hit.at < POLL_GAP)) return hit.run;
  await readRuns(runId);
  return runs.get(runId)?.run ?? { status: "running" };
}

// ---------- Organização do canvas ----------
// Cada envio vira uma fileira nova abaixo do que já existe no canvas: a referência (quando foi enviada agora)
// na primeira coluna, as variações ao lado, todas com nome, e a referência ligada a cada uma por uma seta.
// No canvas do MCP a posição é o topo-centro do nó (o grupo é o canto superior esquerdo).

type GraphNode = { id: string; nodeId: string; type: string; position?: { x: number; y: number }; size?: { width: number; height: number } };

const ROW_GAP = 160;
const COL_GAP = 60;
const DEFAULT_SIZE = { width: 384, height: 683 };

function toNode(n: Rec): GraphNode | null {
  const id = str(n.id, n.short_id, n.node_id);
  if (!id) return null;
  const p = rec(n.position);
  const s = rec(n.size);
  return {
    id,
    nodeId: str(n.node_id, n.uuid) ?? id,
    type: str(n.type) ?? "",
    ...(typeof p.x === "number" && typeof p.y === "number" ? { position: { x: p.x, y: p.y } } : {}),
    ...(typeof s.width === "number" && typeof s.height === "number" ? { size: { width: s.width, height: s.height } } : {}),
  };
}

export async function organizeCanvas(input: {
  projectId: string;
  nodeIds: string[];
  labels: string[];
  references?: FloraReference[];
  referenceLabels?: string[];
}) {
  const { workspaceId } = await targetFor(input.projectId);
  const project_id = pid(input.projectId);
  const canvas = await tool("flora_get_canvas", { project_id, workspace_id: workspaceId });
  const nodes = list(canvas, "nodes")
    .map(toNode)
    .filter((n): n is GraphNode => Boolean(n));
  const edges = list(canvas, "edges").map((e) => ({ from: String(e.from ?? ""), to: String(e.to ?? "") }));
  const find = (id: string | null | undefined) => (id ? nodes.find((n) => n.nodeId === id || n.id === id) : undefined);
  const is = (n: GraphNode, id: string) => n.id === id || n.nodeId === id;

  const batchNodes = input.nodeIds
    .map((id, i) => ({ node: find(id), label: input.labels[i] }))
    .filter((b): b is { node: GraphNode; label: string } => Boolean(b.node));
  if (!batchNodes.length) return;
  // Referências no canvas; as enviadas agora entram na fileira, antes das variações.
  const refs = (input.references ?? [])
    .map((r, i) => ({ node: find(r.nodeId), fresh: Boolean(r.fresh), label: input.referenceLabels?.[i] }))
    .filter((r): r is { node: GraphNode; fresh: boolean; label: string | undefined } => Boolean(r.node));
  const moved = refs.filter((r) => r.fresh);

  const moving = new Set([...batchNodes.map((b) => b.node.id), ...moved.map((r) => r.node.id)]);
  const others = nodes.filter((n) => !moving.has(n.id) && n.position);
  const size = (n: GraphNode) => n.size ?? DEFAULT_SIZE;
  const leftOf = (n: GraphNode) => n.position!.x - (n.type === "group" ? 0 : size(n).width / 2);
  const top = others.length ? Math.max(...others.map((n) => n.position!.y + size(n).height)) + ROW_GAP : 0;
  let cursor = others.length ? Math.min(...others.map(leftOf)) : 0;
  const step = Math.max(...batchNodes.map((b) => size(b.node).width), DEFAULT_SIZE.width);

  const update: { id: string; label?: string; position: { x: number; y: number } }[] = [];
  for (const r of moved) {
    const w = size(r.node).width;
    update.push({ id: r.node.id, ...(r.label ? { label: r.label } : {}), position: { x: cursor + w / 2, y: top } });
    cursor += w + COL_GAP;
  }
  for (const b of batchNodes) {
    update.push({ id: b.node.id, label: b.label, position: { x: cursor + step / 2, y: top } });
    cursor += step + COL_GAP;
  }
  await tool("flora_update_canvas_nodes", { workspace_id: workspaceId, project_id, update });

  const connect = refs.flatMap((r) =>
    batchNodes.filter((b) => !edges.some((e) => is(r.node, e.from) && is(b.node, e.to))).map((b) => ({ from: r.node.id, to: b.node.id })),
  );
  if (!connect.length) return;
  // Algum modelo pode recusar a seta da referência; nome e posição continuam valendo.
  await tool("flora_add_to_canvas", { workspace_id: workspaceId, project_id, connect }).catch((err) =>
    console.warn("[hub] FLORA: não consegui ligar a referência:", err instanceof Error ? err.message : err),
  );
}
