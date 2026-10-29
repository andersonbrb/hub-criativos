import {
  CreateReferenceSourceInputSchema,
  ReferencePostSchema,
  ReferencePostStatusSchema,
  ReferenceSourceConnectionInputSchema,
  ReferenceSourceSchema,
  SelectReferencePostInputSchema,
  SelectTopResultSchema,
  SyncResultSchema,
  routes,
} from '@sbs/contracts';
import type { ReferenceSource } from '@sbs/reference';
import { DomainError, normalizeProductionOptions } from '@sbs/shared-kernel';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../../composition/container';
import { toReferencePostDto, toReferenceSourceDto } from '../mappers/reference-mapper';

const IdParams = z.object({ id: z.string() });

export function referenceRoutes(c: Container): FastifyPluginAsyncZod {
  return async (app) => {
    // Cadastrar páginas e ligar/desligar a leitura é exclusivo do admin.
    const requireAdmin = (role: string) => {
      if (role !== 'admin')
        throw new DomainError(
          'forbidden',
          'Apenas administradores podem gerenciar páginas de referência.',
        );
    };

    /** DTO da página com a contagem de posts importados. */
    const sourceDto = async (source: ReferenceSource) => {
      const posts = await c.reference.listPosts.execute();
      return toReferenceSourceDto(source, posts.filter((p) => p.sourceId === source.id).length);
    };

    const connectedSources = async () =>
      (await c.reference.listSources.execute()).filter((s) => s.isConnected);

    app.get(
      routes.listReferenceSources.path,
      { schema: { response: { 200: z.array(ReferenceSourceSchema) } } },
      async () => {
        const [sources, posts] = await Promise.all([
          c.reference.listSources.execute(),
          c.reference.listPosts.execute(),
        ]);
        const counts = new Map<string, number>();
        for (const post of posts) counts.set(post.sourceId, (counts.get(post.sourceId) ?? 0) + 1);
        return sources.map((s) => toReferenceSourceDto(s, counts.get(s.id) ?? 0));
      },
    );

    app.post(
      routes.createReferenceSource.path,
      {
        schema: {
          body: CreateReferenceSourceInputSchema,
          response: { 201: ReferenceSourceSchema },
        },
      },
      async (req, reply) => {
        requireAdmin(req.user.role);
        const source = await c.reference.registerSource.execute({
          handle: req.body.handle,
          connected: req.body.connected ?? true,
        });
        return reply.status(201).send(toReferenceSourceDto(source, 0));
      },
    );

    app.put(
      routes.updateReferenceSourceConnection.path,
      {
        schema: {
          params: IdParams,
          body: ReferenceSourceConnectionInputSchema,
          response: { 200: ReferenceSourceSchema },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        const source = await c.reference.changeConnection.execute({
          sourceId: req.params.id,
          connected: req.body.connected,
        });
        return sourceDto(source);
      },
    );

    // Lê uma página (precisa estar conectada).
    app.post(
      routes.syncReferenceSource.path,
      { schema: { params: IdParams, response: { 200: SyncResultSchema } } },
      async (req) => ({
        sources: 1,
        ...(await c.reference.sync.execute({ sourceId: req.params.id })),
      }),
    );

    app.get(
      routes.listReferencePosts.path,
      {
        schema: {
          querystring: z.object({ status: ReferencePostStatusSchema.optional() }),
          response: { 200: z.array(ReferencePostSchema) },
        },
      },
      async (req) => {
        const [posts, open] = await Promise.all([
          c.reference.listPosts.execute(req.query.status ? { status: req.query.status } : {}),
          c.reference.adaptations.openByPost(),
        ]);
        return posts.map((post) => toReferencePostDto(post, open.get(post.id) ?? 0));
      },
    );

    // Sincroniza só as páginas conectadas; as desconectadas ficam como estão.
    app.post(
      routes.syncReference.path,
      { schema: { response: { 200: SyncResultSchema } } },
      async () => {
        const total = { sources: 0, imported: 0, updated: 0 };
        for (const source of await connectedSources()) {
          const result = await c.reference.sync.execute({ sourceId: source.id });
          total.sources += 1;
          total.imported += result.imported;
          total.updated += result.updated;
        }
        return total;
      },
    );

    // A seleção automática só considera páginas conectadas.
    app.post(
      routes.selectTopReference.path,
      { schema: { response: { 200: SelectTopResultSchema } } },
      async () => {
        const selected: string[] = [];
        for (const source of await connectedSources()) {
          const winners = await c.reference.selectTop.execute({ sourceId: source.id });
          selected.push(...winners.map((p) => p.id));
        }
        return { selected };
      },
    );

    app.post(
      routes.selectReferencePost.path,
      {
        schema: {
          params: IdParams,
          // Sem corpo, o Fastify entrega `null`: vale o padrão (automático, rápido).
          body: SelectReferencePostInputSchema.nullish(),
          response: { 200: ReferencePostSchema },
        },
      },
      async (req) => {
        await c.reference.select.execute(
          req.params.id,
          normalizeProductionOptions(req.body?.production),
        );
        return reload(c, req.params.id);
      },
    );

    app.post(
      routes.ignoreReferencePost.path,
      { schema: { params: IdParams, response: { 200: ReferencePostSchema } } },
      async (req) => {
        const post = await c.reference.ignore.execute(req.params.id);
        return toReferencePostDto(post, await c.reference.adaptations.countOpen(post.id));
      },
    );
  };
}

/** Recarrega depois dos eventos: selecionar dispara adaptações que alteram o post. */
async function reload(c: Container, id: string) {
  const post = (await c.reference.listPosts.execute()).find((p) => p.id === id);
  if (!post) throw new Error(`Post ${id} sumiu após a seleção.`);
  return toReferencePostDto(post, await c.reference.adaptations.countOpen(post.id));
}
