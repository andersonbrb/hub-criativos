import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// CLI oficial do Higgsfield (@higgsfield/cli). As edições de IA foram removidas do hub (2026-10-06; a edição final é a
// montagem local). Ficou só o status de jobs antigos (refreshGeneration) e a conta.

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
