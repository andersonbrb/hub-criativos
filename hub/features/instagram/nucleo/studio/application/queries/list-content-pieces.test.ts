import { MarketId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ContentPiece } from '../../domain';
import { aContentPiece, createStudioTestKit } from '../../testing';

describe('consultas de peças', () => {
  it('lista as mais recentes primeiro, com filtro por status e mercado', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ id: 'a', status: 'queued' }));
    await kit.pieces.save(aContentPiece({ id: 'b', status: 'awaiting_approval' }));
    await kit.pieces.save(
      aContentPiece({ id: 'c', status: 'queued', marketId: MarketId('market-fr') }),
    );

    const all = await kit.listContentPieces.execute();
    expect(all.map((p) => p.id)).toEqual(['c', 'b', 'a']);

    const queued = await kit.listContentPieces.execute({ status: 'queued' });
    expect(queued.map((p) => p.id)).toEqual(['c', 'a']);

    const fr = await kit.listContentPieces.execute({ marketId: 'market-fr' });
    expect(fr.map((p) => p.id)).toEqual(['c']);

    const both = await kit.listContentPieces.execute({ status: 'queued', marketId: 'market-es' });
    expect(both.map((p) => p.id)).toEqual(['a']);
  });

  it('ordena por data de criação, não por ordem de gravação', async () => {
    const kit = createStudioTestKit();
    const snapshots = [];
    for (const [id, iso] of [
      ['old', '2026-10-01T00:00:00.000Z'],
      ['new', '2026-10-10T00:00:00.000Z'],
    ] as const) {
      const snapshot = aContentPiece({ id }).toSnapshot();
      snapshot.createdAt = iso;
      snapshots.push(snapshot);
    }
    await kit.pieces.save(ContentPiece.fromSnapshot(snapshots[1]!));
    await kit.pieces.save(ContentPiece.fromSnapshot(snapshots[0]!));

    expect((await kit.listContentPieces.execute()).map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('busca uma peça pelo id ou responde not_found', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece());

    expect((await kit.getContentPiece.execute('piece-1')).id).toBe('piece-1');
    await expect(kit.getContentPiece.execute('x')).rejects.toMatchObject({ code: 'not_found' });
  });
});
