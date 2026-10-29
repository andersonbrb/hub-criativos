import { InMemoryDocumentStore } from '@sbs/shared-kernel';
import {
  EditingStandard,
  type EditingStandardRepository,
  type EditingStandardSnapshot,
} from '../../domain';

export class InMemoryEditingStandardRepository implements EditingStandardRepository {
  private readonly store = new InMemoryDocumentStore<EditingStandardSnapshot>('EditingStandard');

  async get(): Promise<EditingStandard> {
    const doc = this.store.get(EditingStandard.ID);
    return doc ? EditingStandard.fromSnapshot(doc) : EditingStandard.initial();
  }

  async save(standard: EditingStandard): Promise<void> {
    standard.markPersisted(this.store.put(standard.toSnapshot()));
  }
}
