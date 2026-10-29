import type { ContentPiece, ContentPieceSummary, Dashboard, Publication } from '@sbs/contracts';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../composition/container';
import { seedDemoData } from '../composition/seed-demo';
import { buildServer, type Server } from '../http/server';
import { asUser, openTestDatabase, testPlatform } from './test-env';

/**
 * Fluxo completo pela API HTTP, com banco PGlite real e adaptadores falsos:
 * referência BR → seleção → adaptação ES/FR → revisão automática → decisão → agenda → publicação.
 */
describe('fluxo da plataforma (API + banco)', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;
  let server: Server;
  const clock = new FixedClock('2026-10-15T12:00:00.000Z');

  const call = async <T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    body?: unknown,
    role = 'reviewer',
  ) => {
    const res = await server.inject({
      method,
      url,
      headers: asUser(role),
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    return { status: res.statusCode, body: res.json() as T };
  };
  const awaiting = async () =>
    (await call<ContentPieceSummary[]>('GET', '/content-pieces?status=awaiting_approval')).body;

  beforeAll(async () => {
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock,
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform(),
    });
    server = await buildServer(container);
    await seedDemoData(container, { runPipeline: false });
  }, 60_000);

  afterAll(async () => {
    container.jobs.close();
    await server.close();
    await handle.close();
  });

  it('importa a referência BR e seleciona os melhores posts', async () => {
    const sync = await call<{ imported: number }>('POST', '/reference/sync');
    expect(sync.status).toBe(200);
    expect(sync.body.imported).toBeGreaterThan(0);

    const top = await call<{ selected: string[] }>('POST', '/reference/select-top');
    expect(top.body.selected.length).toBeGreaterThan(0);
    await container.jobs.drain();
  });

  it('cria uma adaptação por mercado e leva cada uma até a aprovação', async () => {
    const pieces = await awaiting();
    const selected = (await call<{ selected: string[] }>('POST', '/reference/select-top')).body
      .selected;
    expect(selected).toEqual([]); // nada novo para selecionar na mesma janela
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(new Set(pieces.map((p) => p.marketId)).size).toBe(2);
    expect(pieces.every((p) => p.aiScore !== null)).toBe(true);
  });

  it('mostra o original BR, a adaptação e o relatório completo da revisão automática', async () => {
    const [first] = await awaiting();
    const { body: piece } = await call<ContentPiece>('GET', `/content-pieces/${first!.id}`);

    expect(piece.source.caption).not.toBe('');
    expect(piece.currentRevision.caption).toContain('👉');
    expect(piece.currentRevision.assets).not.toBeNull();
    expect(piece.currentRevision.aiReview?.checks.map((c) => c.code)).toContain('forbidden_terms');
  });

  it('recusa editar a legenda com termo proibido (a edição passa pelas regras)', async () => {
    const [first] = await awaiting();
    const res = await call<{ code: string }>('PUT', `/content-pieces/${first!.id}/caption`, {
      caption: 'Conheça o Sagrado Verso!',
      hashtags: ['sanbenito'],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('caption_blocked_by_rules');
  });

  it('a legenda editada passa de novo pela revisão por IA, que pode bloquear a aprovação', async () => {
    const [first] = await awaiting();
    const url = `/content-pieces/${first!.id}`;
    const { body: original } = await call<ContentPiece>('GET', url);
    const { caption, hashtags } = original.currentRevision;

    const blocked = await call<ContentPiece>('PUT', `${url}/caption`, {
      caption: `${caption} Cura garantizada.`,
      hashtags,
    });
    expect(blocked.status).toBe(200);
    const review = blocked.body.currentRevision.aiReview!;
    expect(review).toMatchObject({ trigger: 'caption_edit', hasBlockingIssues: true });
    expect(review.reportId).not.toBe(original.currentRevision.aiReview!.reportId);
    expect(review.checks.find((c) => c.code === 'forbidden_claims')?.status).toBe('fail');
    const summary = (await awaiting()).find((p) => p.id === first!.id);
    expect(summary?.hasBlockingIssues).toBe(true);

    const approve = await call<{ code: string }>('POST', `${url}/decision`, { action: 'approve' });
    expect(approve.status).toBe(422);
    expect(approve.body.code).toBe('blocking_issues_unresolved');

    const fixed = await call<ContentPiece>('PUT', `${url}/caption`, { caption, hashtags });
    expect(fixed.body.currentRevision.aiReview).toMatchObject({
      trigger: 'caption_edit',
      hasBlockingIssues: false,
    });

    // Salvar o mesmo texto não refaz a revisão (nem chama a IA).
    const same = await call<ContentPiece>('PUT', `${url}/caption`, { caption, hashtags });
    expect(same.body.currentRevision.aiReview?.reportId).toBe(
      fixed.body.currentRevision.aiReview?.reportId,
    );
    expect(same.body.history).toHaveLength(fixed.body.history.length);
  });

  it('pedir ajustes gera uma nova revisão com a sugestão, que volta para aprovação', async () => {
    const [first] = await awaiting();
    const res = await call<ContentPiece>('POST', `/content-pieces/${first!.id}/decision`, {
      action: 'request_changes',
      suggestion: 'Deixe a chamada final mais curta.',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('changes_requested');

    await container.jobs.drain();
    const { body: piece } = await call<ContentPiece>('GET', `/content-pieces/${first!.id}`);
    expect(piece.status).toBe('awaiting_approval');
    expect(piece.currentRevision.number).toBe(2);
    expect(piece.currentRevision.requestedChanges?.suggestion).toBe(
      'Deixe a chamada final mais curta.',
    );
  });

  it('aprovar agenda na grade do canal e o agendador publica no horário', async () => {
    const [first] = await awaiting();
    const approved = await call<ContentPiece>('POST', `/content-pieces/${first!.id}/decision`, {
      action: 'approve',
    });
    expect(approved.body.status).toBe('scheduled');
    const scheduledAt = approved.body.publication!.scheduledAt;
    expect(Date.parse(scheduledAt)).toBeGreaterThan(clock.now().getTime());

    clock.set(new Date(Date.parse(scheduledAt) + 60_000).toISOString());
    const result = await container.publishing.publishDue.execute();
    expect(result.published).toBe(1);

    const { body: piece } = await call<ContentPiece>('GET', `/content-pieces/${first!.id}`);
    expect(piece.status).toBe('published');
    expect(piece.publication?.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//);

    const { body: pubs } = await call<Publication[]>('GET', '/publications');
    expect(pubs.find((p) => p.contentPieceId === first!.id)?.status).toBe('published');
  });

  it('reprovar exige motivo e encerra a peça', async () => {
    const [next] = await awaiting();
    const invalid = await call('POST', `/content-pieces/${next!.id}/decision`, {
      action: 'reject',
      reason: '',
    });
    expect(invalid.status).toBe(400);

    const res = await call<ContentPiece>('POST', `/content-pieces/${next!.id}/decision`, {
      action: 'reject',
      reason: 'Tema fora da linha editorial.',
    });
    expect(res.body.status).toBe('rejected');
  });

  it('o painel inicial resume a operação', async () => {
    const { status, body } = await call<Dashboard>('GET', '/dashboard');
    expect(status).toBe(200);
    expect(body.perMarket).toHaveLength(2);
    expect(body.recentActivity.length).toBeGreaterThan(0);
  });

  it('o revisor não altera mercados; o admin sim', async () => {
    const input = {
      code: 'it',
      name: 'Italiano',
      locale: 'it-IT',
      timezone: 'Europe/Rome',
      productName: 'San Benedetto',
      offerUrl: 'https://sanbenito.example.com/it',
      glossary: [],
      forbiddenTerms: [],
    };
    expect((await call('POST', '/markets', input, 'reviewer')).status).toBe(403);
    expect((await call('POST', '/markets', input, 'admin')).status).toBe(201);
  });
});
