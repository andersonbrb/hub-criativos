import { ChannelId } from '@sbs/shared-kernel';
import type { Publication, PublicationRepository } from '../../domain';

export interface ListPublicationsInput {
  /** Inclusivo, sobre o horário agendado. */
  from?: Date;
  /** Inclusivo, sobre o horário agendado. */
  to?: Date;
  channelId?: string;
}

/** Agenda de publicações, ordenada pelo horário agendado. */
export class ListPublications {
  constructor(private readonly publications: PublicationRepository) {}

  async execute(input: ListPublicationsInput = {}): Promise<Publication[]> {
    return this.publications.list({
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.channelId ? { channelId: ChannelId(input.channelId) } : {}),
    });
  }
}
