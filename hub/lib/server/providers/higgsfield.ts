import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { EditTool } from "@/lib/higgsfield-edits";

// O Higgsfield roda pela CLI oficial (@higgsfield/cli), que já está logada nesta máquina
// (`higgsfield auth login`). No hub ele é usado só para EDIÇÃO de vídeo (ver lib/higgsfield-edits.ts).

function binary(): string {
  if (process.env.HIGGSFIELD_BIN) return process.env.HIGGSFIELD_BIN;
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, "npm", "node_modules", "@higgsfield", "cli", "vendor", "hf.exe");
    if (existsSync(exe)) return exe;
  }
  return "higgsfield";
}

export class HiggsfieldError extends Error {}

function run(args: string[], timeoutMs = 120_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary(), [...args, "--json", "--no-color"], { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message).trim().split("\n").slice(0, 3).join(" ");
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new HiggsfieldError("CLI do Higgsfield não encontrada. Rode: npm i -g @higgsfield/cli"));
        }
        if (/auth|login|unauthor/i.test(msg)) {
          return reject(new HiggsfieldError(`Higgsfield não autenticado. Rode no terminal: higgsfield auth login (${msg})`));
        }
        return reject(new HiggsfieldError(`Higgsfield: ${msg}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(stdout.trim());
      }
    });
    // Sem isso a CLI fica esperando dados na entrada padrão quando não roda num terminal.
    child.stdin?.end();
  });
}

export type HfJob = { id: string; status: string; result_url?: string | null; min_result_url?: string | null; job_type?: string };

export async function account() {
  return (await run(["account", "status"])) as { credits: number; email: string; subscription_plan_type: string };
}

// Converte { aspect_ratio: "9:16", fps: 60 } em ["--aspect_ratio", "9:16", "--fps", "60"]
function toFlags(params: Record<string, string | number | boolean>) {
  return Object.entries(params).flatMap(([k, v]) => [`--${k}`, String(v)]);
}

// UUID fictício: a estimativa não precisa do vídeo real (evita subir o arquivo só para orçar).
const PLACEHOLDER_VIDEO = "00000000-0000-0000-0000-000000000000";

export async function editCost(tool: EditTool, params: Record<string, string | number | boolean>, prompt?: string) {
  if (tool.via === "workflow") return null; // a CLI não estima workflows com mídia
  const args = ["generate", "cost", tool.target, "--video", PLACEHOLDER_VIDEO, ...toFlags(params)];
  if (prompt) args.push("--prompt", prompt);
  const out = (await run(args)) as { credits?: number };
  return out.credits ?? null;
}

export async function createEdit(
  tool: EditTool,
  videoPath: string,
  params: Record<string, string | number | boolean>,
  prompt?: string,
) {
  const args =
    tool.via === "workflow" ? ["generate", "workflow", tool.target] : ["generate", "create", tool.target];
  args.push("--video", videoPath); // a CLI sobe o arquivo local
  if (prompt) args.push("--prompt", prompt);
  args.push(...toFlags(params));
  return firstJob(await run(args, 600_000));
}

function firstJob(out: unknown): HfJob {
  const candidates = Array.isArray(out)
    ? out
    : typeof out === "object" && out
      ? ((out as { jobs?: unknown[]; items?: unknown[] }).jobs ?? (out as { items?: unknown[] }).items ?? [out])
      : [];
  const job = candidates.find((j): j is HfJob => typeof j === "object" && j !== null && "id" in j);
  if (!job) throw new HiggsfieldError(`Resposta inesperada da CLI: ${JSON.stringify(out).slice(0, 200)}`);
  return job;
}

export async function getJob(id: string) {
  return firstJob(await run(["generate", "get", id]));
}

export const DONE = new Set(["completed"]);
export const FAILED = new Set(["failed", "nsfw", "canceled", "cancelled", "error"]);
