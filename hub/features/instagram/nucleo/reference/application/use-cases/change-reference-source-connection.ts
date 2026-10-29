import { NotFoundError, ReferenceSourceId } from '@sbs/shared-kernel';
import type { ReferenceSource, ReferenceSourceRepository } from '../../domain';

export interface ChangeReferenceSourceConnectionInput {
  sourceId: string;
  connected: boolean;
}

/** Conecta (passa a ler os posts) ou desconecta (para de ler) uma página de referência. */
export class ChangeReferenceSourceConnection {
  constructor(private readonly sources: ReferenceSourceRepository) {}

  async execute(input: ChangeReferenceSourceConnectionInput): Promise<ReferenceSource> {
    const source = await this.sources.findById(ReferenceSourceId(input.sourceId));
    if (!source) throw new NotFoundError('Conta de referência', input.sourceId);
    if (source.isConnected === input.connected) return source;

    if (input.connected) source.connect();
    else source.disconnect();
    await this.sources.save(source);
    return source;
  }
}
