import Anthropic from '@anthropic-ai/sdk';
import {
  ClaudeContentReviewer,
  FakeContentReviewer,
  type ContentReviewer,
  type ContentReviewInput,
} from '@sbs/governance';
import {
  ApifyReferenceFeed,
  FakeReferenceFeed,
  UnconfiguredReferenceFeed,
  type FeedPost,
  type ReferenceFeed,
} from '@sbs/reference';
import {
  ClaudeCopyLocalizer,
  FakeCopyLocalizer,
  type CopyLocalizer,
  type LocalizeCopyInput,
  type LocalizedCopy,
} from '@sbs/studio';
import type { IntegrationsService } from './integrations';

/**
 * Adaptadores que decidem a cada chamada qual serviço usar, conforme as credenciais salvas
 * na central de integrações. Conectar ou desconectar no painel vale na hora, sem reiniciar.
 */
type Credentials = Pick<IntegrationsService, 'credentials'>;

interface DynamicOptions {
  production: boolean;
  resultsLimit: number;
  /** Só testes: `fetch` simulado para o Apify. */
  fetch?: typeof fetch;
}

/** Apify quando há token; sem token, posts de exemplo só fora de produção. */
export class DynamicReferenceFeed implements ReferenceFeed {
  private readonly fake = new FakeReferenceFeed();
  private readonly unconfigured = new UnconfiguredReferenceFeed();

  constructor(
    private readonly integrations: Credentials,
    private readonly options: DynamicOptions,
  ) {}

  async fetchRecent(source: { id: string; handle: string }, now: Date): Promise<FeedPost[]> {
    const token = (await this.integrations.credentials('apify'))?.['token'];
    if (token) {
      return new ApifyReferenceFeed({
        token,
        resultsLimit: this.options.resultsLimit,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      }).fetchRecent(source);
    }
    return this.options.production
      ? this.unconfigured.fetchRecent()
      : this.fake.fetchRecent(source, now);
  }
}

/** Um cliente por chave (a chave pode mudar no painel). */
class AnthropicClients {
  private current: { key: string; client: Anthropic } | null = null;

  constructor(private readonly integrations: Credentials) {}

  async get(): Promise<Anthropic | null> {
    const key = (await this.integrations.credentials('anthropic'))?.['apiKey'];
    if (!key) return null;
    if (this.current?.key !== key) this.current = { key, client: new Anthropic({ apiKey: key }) };
    return this.current.client;
  }
}

/** Claude quando há chave da Anthropic; sem ela, o localizador de testes (só glossário). */
export class DynamicCopyLocalizer implements CopyLocalizer {
  private readonly fake = new FakeCopyLocalizer();

  constructor(private readonly clients: AnthropicClients) {}

  async localize(input: LocalizeCopyInput): Promise<LocalizedCopy> {
    const client = await this.clients.get();
    return client ? new ClaudeCopyLocalizer(client).localize(input) : this.fake.localize(input);
  }
}

/** Claude quando há chave da Anthropic; sem ela, o revisor de testes. */
export class DynamicContentReviewer implements ContentReviewer {
  private readonly fake = new FakeContentReviewer();

  constructor(private readonly clients: AnthropicClients) {}

  async review(input: ContentReviewInput) {
    const client = await this.clients.get();
    return client ? new ClaudeContentReviewer(client).review(input) : this.fake.review(input);
  }
}

export function dynamicAdapters(integrations: Credentials, options: DynamicOptions) {
  const clients = new AnthropicClients(integrations);
  return {
    referenceFeed: new DynamicReferenceFeed(integrations, options),
    copyLocalizer: new DynamicCopyLocalizer(clients),
    contentReviewer: new DynamicContentReviewer(clients),
  };
}
