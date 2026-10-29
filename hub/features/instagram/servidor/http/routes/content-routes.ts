import {
  ContentPieceFilterSchema,
  ContentPieceSchema,
  ContentPieceSummarySchema,
  DecisionInputSchema,
  EditCaptionInputSchema,
  routes,
} from '@sbs/contracts';
import { ContentPieceId, ReviewReportId } from '@sbs/shared-kernel';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../../composition/container';
import { toContentPieceDto, toContentPieceSummary } from '../mappers/content-mapper';

const IdParams = z.object({ id: z.string() });

export function contentRoutes(c: Container): FastifyPluginAsyncZod {
  return async (app) => {
    const dto = async (id: string) =>
      toContentPieceDto(
        await c.studio.get.execute(id),
        async (pieceId, revision, reportId) =>
          (reportId ? await c.governance.repo.findById(ReviewReportId(reportId)) : null) ??
          c.governance.repo.findByRevision(ContentPieceId(pieceId), revision),
      );

    app.get(
      routes.listContentPieces.path,
      {
        schema: {
          querystring: ContentPieceFilterSchema,
          response: { 200: z.array(ContentPieceSummarySchema) },
        },
      },
      async (req) => {
        const { status, marketId } = req.query;
        const pieces = await c.studio.list.execute({
          ...(status ? { status } : {}),
          ...(marketId ? { marketId } : {}),
        });
        return pieces.map(toContentPieceSummary);
      },
    );

    app.get(
      routes.getContentPiece.path,
      { schema: { params: IdParams, response: { 200: ContentPieceSchema } } },
      async (req) => dto(req.params.id),
    );

    app.post(
      routes.decideContentPiece.path,
      {
        schema: {
          params: IdParams,
          body: DecisionInputSchema,
          response: { 200: ContentPieceSchema },
        },
      },
      async (req) => {
        await c.studio.decide.execute({
          contentPieceId: req.params.id,
          reviewerId: req.user.id,
          decision: req.body,
        });
        // Recarrega: aprovar agenda a publicação, que altera a peça logo em seguida.
        return dto(req.params.id);
      },
    );

    app.put(
      routes.editCaption.path,
      {
        schema: {
          params: IdParams,
          body: EditCaptionInputSchema,
          response: { 200: ContentPieceSchema },
        },
      },
      async (req) => {
        await c.studio.editCaption.execute({
          contentPieceId: req.params.id,
          editorId: req.user.id,
          caption: req.body.caption,
          hashtags: req.body.hashtags,
        });
        return dto(req.params.id);
      },
    );

    app.post(
      routes.retryContentPiece.path,
      { schema: { params: IdParams, response: { 200: ContentPieceSchema } } },
      async (req) => {
        await c.studio.retry.execute({ contentPieceId: req.params.id });
        return dto(req.params.id);
      },
    );
  };
}
