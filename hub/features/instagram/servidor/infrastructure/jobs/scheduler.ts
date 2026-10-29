interface Logger {
  error(obj: unknown, msg?: string): void;
}

/** Executa `task` a cada `intervalMs`, sem sobrepor execuções. */
export class IntervalScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly task: () => Promise<void>,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.task();
    } catch (err) {
      this.logger.error({ err, scheduler: this.name }, 'Falha no agendador');
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
