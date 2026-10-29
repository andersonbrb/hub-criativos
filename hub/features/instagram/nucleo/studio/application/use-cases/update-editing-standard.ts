import type { Clock } from '@sbs/shared-kernel';
import type {
  EditingStandard,
  EditingStandardChanges,
  EditingStandardRepository,
} from '../../domain';

/** O time edita o Padrão de Edição que os agentes de edição seguem. */
export class UpdateEditingStandard {
  constructor(
    private readonly standards: EditingStandardRepository,
    private readonly clock: Clock,
  ) {}

  async execute(changes: EditingStandardChanges, by: string): Promise<EditingStandard> {
    const standard = await this.standards.get();
    standard.update(changes, by, this.clock.now());
    await this.standards.save(standard);
    return standard;
  }
}
