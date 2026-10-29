import { ReferenceSourceId, type IdGenerator } from '@sbs/shared-kernel';
import {
  ReferenceErrors,
  ReferenceSource,
  normalizeHandle,
  type ReferenceSourceProps,
  type ReferenceSourceRepository,
} from '../../domain';

/** Cadastra uma página de referência (pelo @ ou pelo link do perfil). */
export class RegisterReferenceSource {
  constructor(
    private readonly sources: ReferenceSourceRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: ReferenceSourceProps): Promise<ReferenceSource> {
    const handle = normalizeHandle(input.handle);
    if (await this.sources.findByHandle(handle)) throw ReferenceErrors.sourceHandleTaken(handle);

    const source = ReferenceSource.create(ReferenceSourceId(this.ids.next()), input);
    await this.sources.save(source);
    return source;
  }
}
