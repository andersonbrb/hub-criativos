import type { PublishRequest, PublishResult, SocialPublisher } from '../../application';

export interface FakeSocialPublisherOptions {
  /** Falha nas primeiras N chamadas e depois funciona. */
  failTimes?: number;
  /** Falha sempre (ex.: conta desconectada). */
  alwaysFail?: boolean;
}

/**
 * Publicador determinístico para dev e testes: o n-ésimo post publicado recebe
 * `fake-<n>` e `https://www.instagram.com/p/SBS<n>/`.
 */
export class FakeSocialPublisher implements SocialPublisher {
  readonly requests: PublishRequest[] = [];
  private published = 0;
  private remainingFailures: number;

  constructor(private readonly options: FakeSocialPublisherOptions = {}) {
    this.remainingFailures = options.failTimes ?? 0;
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    this.requests.push(request);
    if (this.options.alwaysFail) throw new Error('Instagram indisponível (falha simulada).');
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error('Instagram indisponível (falha simulada).');
    }
    this.published += 1;
    return {
      externalMediaId: `fake-${this.published}`,
      permalink: `https://www.instagram.com/p/SBS${this.published}/`,
    };
  }
}
