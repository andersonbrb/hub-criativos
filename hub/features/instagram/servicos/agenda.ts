import "server-only";

import { StudioJobs, type ProduceJobPayload } from "@sbs/studio";
import { sql } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { instagramDocumentos } from "@/db/schema";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";

import { instagram } from "./plataforma";

// As tarefas automáticas do Instagram, ligadas na subida do servidor (instrumentation.ts), como a fila do YouTube:
// - a cada minuto, publica o que chegou na hora (na grade de horários de cada conta), em cada organização;
// - na subida, cuida das peças que o reinício interrompeu: a que estava produzindo vira "falhou" com o motivo (a
//   pessoa manda tentar de novo na tela) e a que esperava na fila volta para a fila.
// O hub roda numa réplica só (no projeto de origem também): duas réplicas publicariam em dobro.

const MINUTO_MS = 60_000;

const g = globalThis as typeof globalThis & { __hubAgendaDoInstagram?: NodeJS.Timeout };

// Organizações que têm algo do Instagram (as outras não precisam de nada).
async function organizacoesComInstagram(tipo: string): Promise<string[]> {
  const linhas = await banco()
    .selectDistinct({ org: instagramDocumentos.organizacaoId })
    .from(instagramDocumentos)
    .where(sql`${instagramDocumentos.tipo} = ${tipo}`);
  return linhas.map((l) => l.org);
}

let publicando = false;

async function publicarVencidas() {
  if (publicando) return;
  publicando = true;
  try {
    const { container } = await instagram();
    for (const org of await organizacoesComInstagram("publishing.publication")) {
      await comOrganizacao(org, async () => {
        const r = await container.publishing.publishDue.execute();
        if (r.published + r.failed + r.retried > 0) console.log(`[instagram] ${org}: publicadas ${r.published}, falhas ${r.failed}, novas tentativas ${r.retried}.`);
      }).catch((err) => console.error(`[instagram] ${org}: não deu para publicar as vencidas:`, err instanceof Error ? err.message : err));
    }
  } finally {
    publicando = false;
  }
}

async function retomarPecas() {
  const { container } = await instagram();
  const agora = new Date();
  for (const org of await organizacoesComInstagram("studio.content_piece")) {
    await comOrganizacao(org, async () => {
      const pecas = await container.studio.repo.list();
      let falharam = 0;
      let voltaram = 0;
      for (const peca of pecas) {
        if (peca.status === "producing") {
          peca.failProduction("O servidor do hub reiniciou no meio da produção. Use “Tentar de novo”.", agora);
          await container.studio.repo.save(peca);
          await container.events.publish(peca.pullEvents());
          falharam++;
        } else if (peca.status === "queued" || peca.status === "changes_requested") {
          await container.jobs.enqueue<ProduceJobPayload>(StudioJobs.produce, { contentPieceId: peca.id });
          voltaram++;
        }
      }
      if (falharam + voltaram) console.log(`[instagram] ${org}: ${falharam} peça(s) interrompida(s) pelo reinício, ${voltaram} de volta à fila.`);
    }).catch((err) => console.error(`[instagram] ${org}: não deu para retomar as peças:`, err instanceof Error ? err.message : err));
  }
}

export function iniciarAgendaDoInstagram() {
  if (g.__hubAgendaDoInstagram) return;
  g.__hubAgendaDoInstagram = setInterval(() => void publicarVencidas(), MINUTO_MS);
  void retomarPecas().catch((err) => console.error("[instagram] não deu para retomar as peças:", err instanceof Error ? err.message : err));
}
