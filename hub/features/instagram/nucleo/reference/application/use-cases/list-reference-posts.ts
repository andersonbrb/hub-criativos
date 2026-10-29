import {
  compareByPerformance,
  type ReferencePost,
  type ReferencePostFilter,
  type ReferencePostRepository,
} from '../../domain';

/** Posts de referência do melhor para o pior desempenho (empate: o mais recente primeiro). */
export class ListReferencePosts {
  constructor(private readonly posts: ReferencePostRepository) {}

  async execute(filter: ReferencePostFilter = {}): Promise<ReferencePost[]> {
    return (await this.posts.list(filter)).sort(compareByPerformance);
  }
}
