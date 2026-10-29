import { ReferenceSourceId } from '@sbs/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReferenceSource } from '../../domain';
import { InMemoryReferenceSourceRepository } from '../../infrastructure';
import { ChangeReferenceSourceConnection } from './change-reference-source-connection';

describe('ChangeReferenceSourceConnection', () => {
  let sources: InMemoryReferenceSourceRepository;
  let change: ChangeReferenceSourceConnection;

  beforeEach(async () => {
    sources = new InMemoryReferenceSourceRepository();
    change = new ChangeReferenceSourceConnection(sources);
    await sources.save(ReferenceSource.create(ReferenceSourceId('src-1'), { handle: 'pagina' }));
  });

  it('desconecta e reconecta, gravando a mudança', async () => {
    await change.execute({ sourceId: 'src-1', connected: false });
    expect((await sources.findById(ReferenceSourceId('src-1')))?.isConnected).toBe(false);

    await change.execute({ sourceId: 'src-1', connected: true });
    expect((await sources.findById(ReferenceSourceId('src-1')))?.isConnected).toBe(true);
  });

  it('sem mudança não grava de novo (não sobe a versão)', async () => {
    const before = (await sources.findById(ReferenceSourceId('src-1')))!.version;
    await change.execute({ sourceId: 'src-1', connected: true });
    expect((await sources.findById(ReferenceSourceId('src-1')))!.version).toBe(before);
  });

  it('falha para página inexistente', async () => {
    await expect(change.execute({ sourceId: 'nao-existe', connected: true })).rejects.toMatchObject(
      {
        name: 'NotFoundError',
      },
    );
  });
});
