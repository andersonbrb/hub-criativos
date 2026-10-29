import type { EditingStandard } from './editing-standard';

export interface EditingStandardRepository {
  /** O padrão salvo, ou o inicial se o time ainda não editou. */
  get(): Promise<EditingStandard>;
  save(standard: EditingStandard): Promise<void>;
}
