import "server-only";

import { mcp } from "@/lib/server/mcp-client";

// Higgsfield pelo MCP oficial, com o login da conta em Integrações → Higgsfield (como HeyGen, FLORA e ElevenLabs), no
// lugar da CLI que precisava estar instalada e logada no terminal. As edições de IA foram removidas do hub
// (2026-10-06; a edição final é a montagem local). Ficou o status de jobs antigos (refreshGeneration) e os créditos.

export class HiggsfieldError extends Error {}

export type HfJob = { id: string; status: string; result_url?: string | null };

export async function account() {
  const out = await mcp("higgsfield").callTool<{ credits?: unknown; subscription_plan_type?: unknown }>("balance");
  return { credits: Number(out.credits ?? 0), subscription_plan_type: String(out.subscription_plan_type ?? "") };
}

type Espera = { jobs?: (Record<string, unknown> & { status?: string; error?: string })[] };

// Endereço do resultado pronto: o primeiro link do job, deixando miniaturas e prévias por último.
function linkDoResultado(job: Record<string, unknown>): string | null {
  const links: { chave: string; url: string }[] = [];
  const visitar = (valor: unknown, chave: string) => {
    if (typeof valor === "string" && /^https?:\/\//.test(valor)) links.push({ chave, url: valor });
    else if (Array.isArray(valor)) valor.forEach((v) => visitar(v, chave));
    else if (valor && typeof valor === "object") for (const [k, v] of Object.entries(valor)) visitar(v, k);
  };
  visitar(job, "");
  const reduzido = (chave: string) => /min|thumb|preview/i.test(chave);
  return (links.find((l) => !reduzido(l.chave)) ?? links[0])?.url ?? null;
}

export async function getJob(id: string): Promise<HfJob> {
  // timeout 0: só a foto do momento; quem chama já volta a perguntar de tempos em tempos.
  const out = await mcp("higgsfield").callTool<Espera>("jobs_wait", { jobs: [{ index: 0, job_id: id }], timeout_seconds: 0 });
  const job = out.jobs?.[0];
  if (!job) throw new HiggsfieldError("O Higgsfield não respondeu sobre esse job.");
  if (job.status === "lookup_failed") throw new HiggsfieldError("O Higgsfield não achou esse job na conta conectada.");
  return { id, status: String(job.status ?? ""), result_url: linkDoResultado(job) };
}

export const DONE = new Set(["completed"]);
export const FAILED = new Set(["failed", "nsfw", "canceled", "cancelled", "error"]);
