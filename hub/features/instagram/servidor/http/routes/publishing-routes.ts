import {
  PublicationFilterSchema,
  PublicationSchema,
  RescheduleInputSchema,
  routes,
} from '@sbs/contracts';
import { ChannelId } from '@sbs/shared-kernel';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../../composition/container';
import { toPublicationDto } from '../mappers/publishing-mapper';

const IdParams = z.object({ id: z.string() });

export function publishingRoutes(c: Container): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      routes.listPublications.path,
      {
        schema: {
          querystring: PublicationFilterSchema,
          response: { 200: z.array(PublicationSchema) },
        },
      },
      async (req) => {
        const { from, to, channelId } = req.query;
        const publications = await c.publishing.list.execute({
          ...(from ? { from: new Date(from) } : {}),
          ...(to ? { to: new Date(to) } : {}),
          ...(channelId ? { channelId: ChannelId(channelId) } : {}),
        });
        return publications.map(toPublicationDto);
      },
    );

    app.patch(
      routes.reschedulePublication.path,
      {
        schema: {
          params: IdParams,
          body: RescheduleInputSchema,
          response: { 200: PublicationSchema },
        },
      },
      async (req) =>
        toPublicationDto(
          await c.publishing.reschedule.execute(req.params.id, {
            scheduledAt: new Date(req.body.scheduledAt),
          }),
        ),
    );

    app.post(
      routes.cancelPublication.path,
      { schema: { params: IdParams, response: { 200: PublicationSchema } } },
      async (req) => toPublicationDto(await c.publishing.cancel.execute(req.params.id)),
    );
  };
}
