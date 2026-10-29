import type { JobQueue } from '@sbs/shared-kernel';

import { comOrganizacao, organizacaoAtual } from '@/features/acesso/servicos/organizacao-atual';

type JobHandler = (payload: unknown) => Promise<void>;

interface Logger {
  error(obj: unknown, msg?: string): void;
}

/**
 * Fila em processo: executa cada job fora da requisição (próximo tick) ou no horário pedido, sempre na organização
 * de quem pediu (o timer roda fora do pedido, então a organização vai junto com o job). O hub roda numa réplica só.
 */
export class InProcessJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly logger: Logger) {}

  register<TPayload>(job: string, handler: (payload: TPayload) => Promise<void>): void {
    this.handlers.set(job, handler as JobHandler);
  }

  async enqueue<TPayload>(
    job: string,
    payload: TPayload,
    options?: { runAt?: Date },
  ): Promise<void> {
    const handler = this.handlers.get(job);
    if (!handler) throw new Error(`Nenhum handler registrado para o job "${job}".`);
    const org = await organizacaoAtual();

    const delay = Math.max(0, (options?.runAt?.getTime() ?? 0) - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const run = comOrganizacao(org, () => handler(payload))
        .catch((err: unknown) => this.logger.error({ err, job }, 'Falha ao executar job'))
        .finally(() => this.inFlight.delete(run));
      this.inFlight.add(run);
    }, delay);
    this.timers.add(timer);
  }

  /** Espera esvaziar a fila (jobs imediatos e os que eles enfileirarem). Usado em testes. */
  async drain(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (this.inFlight.size === 0 && this.timers.size === 0) return;
      await Promise.all([...this.inFlight]);
    }
  }

  close(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
