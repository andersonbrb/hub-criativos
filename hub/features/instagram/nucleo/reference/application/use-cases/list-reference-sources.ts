import type { ReferenceSource, ReferenceSourceRepository } from '../../domain';

export class ListReferenceSources {
  constructor(private readonly sources: ReferenceSourceRepository) {}

  async execute(): Promise<ReferenceSource[]> {
    return this.sources.list();
  }
}
