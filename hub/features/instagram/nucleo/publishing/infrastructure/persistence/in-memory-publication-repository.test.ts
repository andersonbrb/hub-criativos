import { ChannelId, ConcurrencyError, ContentPieceId, PublicationId } from '@sbs/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { aPublication } from '../../testing';
import { FakeSocialPublisher } from '../adapters/fake-social-publisher';
import { InMemoryPublicationRepository } from './in-memory-publication-repository';

describe('InMemoryPublicationRepository', () => {
  let repo: InMemoryPublicationRepository;

  beforeEach(async () => {
    repo = new InMemoryPublicationRepository();
    await repo.save(aPublication({ id: 'late', scheduledAt: new Date('2026-10-15T20:00:00Z') }));
    await repo.save(aPublication({ id: 'early', scheduledAt: new Date('2026-10-15T10:00:00Z') }));
    const cancelled = aPublication({
      id: 'cancelled',
      contentPieceId: ContentPieceId('cp-2'),
      scheduledAt: new Date('2026-10-15T09:00:00Z'),
    });
    cancelled.cancel();
    await repo.save(cancelled);
  });

  it('findDue devolve só as agendadas até agora, mais antigas primeiro', async () => {
    const due = await repo.findDue(new Date('2026-10-15T20:00:00Z'));
    expect(due.map((p) => p.id)).toEqual(['early', 'late']);
    expect(await repo.findDue(new Date('2026-10-15T09:59:59Z'))).toEqual([]);
  });

  it('findActiveByContentPiece ignora canceladas', async () => {
    expect(await repo.findActiveByContentPiece(ContentPieceId('cp-2'))).toBeNull();
    expect(await repo.findActiveByContentPiece(ContentPieceId('cp-1'))).not.toBeNull();
  });

  it('listByChannel filtra por status quando informado', async () => {
    const channel = ChannelId('ch-1');
    expect((await repo.listByChannel(channel)).map((p) => p.id)).toEqual([
      'cancelled',
      'early',
      'late',
    ]);
    expect((await repo.listByChannel(channel, ['cancelled'])).map((p) => p.id)).toEqual([
      'cancelled',
    ]);
  });

  it('recusa gravar a partir de uma cópia desatualizada', async () => {
    const a = await repo.findById(PublicationId('early'));
    const b = await repo.findById(PublicationId('early'));
    if (!a || !b) throw new Error('esperava a publicação');
    a.cancel();
    await repo.save(a);
    b.cancel();
    await expect(repo.save(b)).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe('FakeSocialPublisher', () => {
  const request = {
    channelId: 'channel-es',
    channelExternalAccountId: 'ig',
    format: 'carousel' as const,
    assets: { format: 'carousel' as const, slideUrls: ['https://cdn.example.com/1.jpg'] },
    caption: 'legenda',
  };

  it('numera os posts publicados de forma determinística', async () => {
    const publisher = new FakeSocialPublisher({ failTimes: 1 });
    await expect(publisher.publish(request)).rejects.toThrow(/falha simulada/);
    expect(await publisher.publish(request)).toEqual({
      externalMediaId: 'fake-1',
      permalink: 'https://www.instagram.com/p/SBS1/',
    });
    expect((await publisher.publish(request)).externalMediaId).toBe('fake-2');
    expect(publisher.requests).toHaveLength(3);
  });

  it('pode falhar sempre', async () => {
    const publisher = new FakeSocialPublisher({ alwaysFail: true });
    await expect(publisher.publish(request)).rejects.toThrow(Error);
    await expect(publisher.publish(request)).rejects.toThrow(Error);
  });
});
