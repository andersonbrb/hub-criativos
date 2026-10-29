import { ReferenceSourceId, type Clock, type EventBus } from '@sbs/shared-kernel';
import {
  SelectionPolicy,
  type ReferencePost,
  type ReferencePostRepository,
  type SelectionPolicyConfig,
} from '../../domain';

export interface SelectTopPerformersInput {
  /** Restringe o ranking a uma conta de referência. Sem isso, considera todas. */
  sourceId?: string;
}

/** Aplica a política de seleção e seleciona os vencedores; cada seleção dispara a adaptação. */
export class SelectTopPerformers {
  private readonly policy: SelectionPolicy;

  constructor(
    private readonly posts: ReferencePostRepository,
    private readonly clock: Clock,
    private readonly events: EventBus,
    policyConfig: Partial<SelectionPolicyConfig> = {},
  ) {
    this.policy = new SelectionPolicy(policyConfig);
  }

  async execute(input: SelectTopPerformersInput = {}): Promise<ReferencePost[]> {
    const now = this.clock.now();
    const candidates =
      input.sourceId === undefined
        ? await this.posts.list()
        : await this.posts.listBySource(ReferenceSourceId(input.sourceId));

    const winners = this.policy.pickWinners(candidates, now);
    for (const post of winners) {
      post.select(now);
      await this.posts.save(post);
      await this.events.publish(post.pullEvents());
    }
    return winners;
  }
}
