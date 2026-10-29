import {
  ChannelSchema,
  CreateChannelInputSchema,
  CreateMarketInputSchema,
  MarketSchema,
  UpdateMarketInputSchema,
  UpdatePostingPlanInputSchema,
  routes,
} from '@sbs/contracts';
import { DomainError } from '@sbs/shared-kernel';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../../composition/container';
import { toChannelDto, toMarketDto } from '../mappers/markets-mapper';

const IdParams = z.object({ id: z.string() });

export function marketsRoutes(c: Container): FastifyPluginAsyncZod {
  return async (app) => {
    // Configurar mercados e canais é exclusivo do admin.
    const requireAdmin = (role: string) => {
      if (role !== 'admin')
        throw new DomainError('forbidden', 'Apenas administradores podem alterar mercados.');
    };

    app.get(
      routes.listMarkets.path,
      { schema: { response: { 200: z.array(MarketSchema) } } },
      async () => (await c.markets.repo.list()).map(toMarketDto),
    );

    app.post(
      routes.createMarket.path,
      { schema: { body: CreateMarketInputSchema, response: { 201: MarketSchema } } },
      async (req, reply) => {
        requireAdmin(req.user.role);
        const market = await c.markets.createMarket.execute(req.body);
        return reply.status(201).send(toMarketDto(market));
      },
    );

    app.patch(
      routes.updateMarket.path,
      {
        schema: {
          params: IdParams,
          body: UpdateMarketInputSchema,
          response: { 200: MarketSchema },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        return toMarketDto(
          await c.markets.updateMarket.execute(req.params.id, stripUndefined(req.body)),
        );
      },
    );

    app.get(
      routes.listChannels.path,
      { schema: { response: { 200: z.array(ChannelSchema) } } },
      async () => (await c.markets.channels.list()).map(toChannelDto),
    );

    app.post(
      routes.createChannel.path,
      { schema: { body: CreateChannelInputSchema, response: { 201: ChannelSchema } } },
      async (req, reply) => {
        requireAdmin(req.user.role);
        const channel = await c.markets.createChannel.execute(stripUndefined(req.body));
        return reply.status(201).send(toChannelDto(channel));
      },
    );

    app.put(
      routes.updatePostingPlan.path,
      {
        schema: {
          params: IdParams,
          body: UpdatePostingPlanInputSchema,
          response: { 200: ChannelSchema },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        return toChannelDto(
          await c.markets.updatePostingPlan.execute(req.params.id, req.body.postingPlan),
        );
      },
    );
  };
}

/** Remove chaves `undefined` vindas de campos opcionais do Zod. */
function stripUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
