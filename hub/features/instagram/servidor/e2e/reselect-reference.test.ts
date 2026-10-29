import type { ContentPiece, ReferencePost } from '@sbs/contracts';
import { ReferencePostId } from '@sbs/shared-kernel';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../composition/container';
import { seedDemoData } from '../composition/seed-demo';
import { buildServer, type Server } from '../http/server';
import { asUser, openTestDatabase, testPlatform } from './test-env';

/** Selecionar de novo um post: bloqueado com adaptação em andamento, liberado depois de reprovada. */
describe('nova seleção de um post de referência (API + banco)', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;
  let server: Server;
  let postId: string;

  const call = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await server.inject({
      method,
      url,
      headers: asUser('admin'),
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    return { status: res.statusCode, body: res.json() as T };
  };
  const post = async () =>
    (await call<ReferencePost[]>('GET', '/reference/posts')).body.find((p) => p.id === postId)!;
  const piecesOf = async () =>
    (await container.studio.repo.listByReference(ReferencePostId(postId))).map((p) => ({
      id: p.id as string,
      status: p.status,
    }));

  beforeAll(async () => {
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock: new FixedClock('2026-10-15T12:00:00.000Z'),
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform(),
    });
    server = await buildServer(container);
    await seedDemoData(container, { runPipeline: false });
    await call('POST', '/reference/sync');
    const reel = (await call<ReferencePost[]>('GET', '/reference/posts')).body.find(
      (p) => p.format === 'reel',
    )!;
    postId = reel.id;
  }, 60_000);

  afterAll(async () => {
    container.jobs.close();
    await server.close();
    await handle.close();
  });

  it('a primeira seleção cria uma adaptação por mercado', async () => {
    expect((await call('POST', `/reference/posts/${postId}/select`)).status).toBe(200);
    await container.jobs.drain();

    expect(await piecesOf()).toHaveLength(2);
    expect(await post()).toMatchObject({ status: 'selected', openAdaptationsCount: 2 });

    // O registro de produção chega ao painel: sem armazenamento, a etapa é pulada com o motivo.
    const [first] = await piecesOf();
    const detail = await call<ContentPiece>('GET', `/content-pieces/${first!.id}`);
    const production = detail.body.revisions.at(-1)!.production;
    expect(production.map((s) => [s.kind, s.status])).toEqual([
      ['ingest', 'skipped'],
      ['subtitle_removal', 'skipped'],
      ['video_translation', 'skipped'],
      ['audio', 'skipped'],
      ['editing', 'skipped'],
      ['images', 'skipped'],
      ['caption', 'approved'],
      ['creative', 'approved'],
    ]);
    // Reel sem HeyGen nem ElevenLabs: a tradução do vídeo é pulada com o motivo.
    expect(production[1]!.note).toBe(
      'vMake não conectada: o vídeo segue com as legendas originais.',
    );
    expect(production[2]!.note).toBe('Tradução não feita: nem HeyGen nem ElevenLabs conectados.');
    expect(production[0]!.note).toContain('Armazenamento de mídia não configurado');
  });

  it('com adaptação em andamento, selecionar de novo é recusado', async () => {
    const again = await call<{ code: string }>('POST', `/reference/posts/${postId}/select`);
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('adaptations_in_progress');
    expect(await piecesOf()).toHaveLength(2);
  });

  it('depois de reprovadas, selecionar de novo abre uma nova rodada', async () => {
    for (const piece of await piecesOf()) {
      const res = await call('POST', `/content-pieces/${piece.id}/decision`, {
        action: 'reject',
        reason: 'Não combina com o mercado',
      });
      expect(res.status).toBe(200);
    }
    expect((await post()).openAdaptationsCount).toBe(0);

    const again = await call<ReferencePost>('POST', `/reference/posts/${postId}/select`);
    expect(again.status).toBe(200);
    await container.jobs.drain();

    const pieces = await piecesOf();
    expect(pieces).toHaveLength(4);
    expect(pieces.filter((p) => p.status !== 'rejected')).toHaveLength(2);
    expect(await post()).toMatchObject({ status: 'selected', openAdaptationsCount: 2 });
  });
});
