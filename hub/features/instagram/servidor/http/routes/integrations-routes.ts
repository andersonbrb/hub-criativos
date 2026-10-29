import {
  ChangeChannelMarketInputSchema,
  ChannelPublishingInputSchema,
  ConnectIntegrationInputSchema,
  FloraImageModelsSchema,
  InstagramAuthorizeInputSchema,
  InstagramAuthorizeResultSchema,
  IntegrationIdSchema,
  IntegrationStatusSchema,
  routes,
} from '@sbs/contracts';
import { DomainError } from '@sbs/shared-kernel';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../../composition/container';
import { DEFAULT_IMAGE_MODEL } from '../../composition/production/images-stage';

const IdParams = z.object({ id: IntegrationIdSchema });
const ChannelParams = z.object({ channelId: z.string() });

/** Volta para Configurações → Integrações com o resultado do login do Instagram. */
function backToSettings(result: { ok: true; handle: string } | { ok: false; message: string }) {
  const params = new URLSearchParams(
    result.ok
      ? { integracao: 'instagram', resultado: 'ok', conta: result.handle }
      : { integracao: 'instagram', resultado: 'erro', mensagem: result.message },
  );
  const target = `/instagram/configuracoes?${params.toString()}`;
  const escaped = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"><title>Voltando ao painel…</title></head><body><p>Voltando ao painel… <a href="${escaped}">continuar</a></p><script>location.replace(${JSON.stringify(target)})</script></body></html>`;
}

export function integrationsRoutes(c: Container): FastifyPluginAsyncZod {
  return async (app) => {
    // Conectar, trocar ou remover credenciais é exclusivo do admin.
    const requireAdmin = (role: string) => {
      if (role !== 'admin')
        throw new DomainError('forbidden', 'Apenas administradores podem gerenciar integrações.');
    };

    app.get(
      routes.listIntegrations.path,
      { schema: { response: { 200: z.array(IntegrationStatusSchema) } } },
      () => c.integrations.list(),
    );

    // Modelos de edição de imagem da FLORA (lista ao vivo, para escolher na seleção do post).
    app.get(
      routes.floraImageModels.path,
      { schema: { response: { 200: FloraImageModelsSchema } } },
      async () => {
        const flora = await c.productionTools.flora();
        return {
          connected: flora !== null,
          defaultModel: DEFAULT_IMAGE_MODEL,
          models: flora ? await flora.imageEditModels() : [],
        };
      },
    );

    app.put(
      routes.connectIntegration.path,
      {
        schema: {
          params: IdParams,
          body: ConnectIntegrationInputSchema,
          response: { 200: IntegrationStatusSchema },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        return c.integrations.connect();
      },
    );

    app.delete(
      routes.disconnectIntegration.path,
      { schema: { params: IdParams, response: { 200: IntegrationStatusSchema } } },
      async (req) => {
        requireAdmin(req.user.role);
        return c.integrations.disconnect();
      },
    );

    app.post(
      routes.authorizeInstagramAccount.path,
      {
        schema: {
          body: InstagramAuthorizeInputSchema,
          response: { 200: InstagramAuthorizeResultSchema },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        const origin = new URL(req.body.origin).origin;
        return { url: await c.integrations.authorizeAccount(req.body.marketId, origin) };
      },
    );

    app.put(
      routes.changeInstagramChannelMarket.path,
      {
        schema: {
          params: ChannelParams,
          body: ChangeChannelMarketInputSchema,
          response: { 200: IntegrationStatusSchema },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        await c.integrations.changeChannelMarket(req.params.channelId, req.body.marketId);
        return c.integrations.status('instagram');
      },
    );

    // Liga/desliga a publicação real de uma conta (desligada, a publicação é simulada).
    app.put(
      routes.setInstagramChannelPublishing.path,
      {
        schema: {
          params: ChannelParams,
          body: ChannelPublishingInputSchema,
          response: { 200: IntegrationStatusSchema },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        await c.integrations.setChannelPublishing(req.params.channelId, req.body.enabled);
        return c.integrations.status('instagram');
      },
    );

    app.delete(
      routes.disconnectInstagramChannel.path,
      { schema: { params: ChannelParams, response: { 200: IntegrationStatusSchema } } },
      async (req) => {
        requireAdmin(req.user.role);
        await c.integrations.disconnectChannel(req.params.channelId);
        return c.integrations.status('instagram');
      },
    );

    // Retorno do login do Instagram (o navegador chega aqui vindo do instagram.com).
    app.get(
      routes.instagramCallback.path,
      {
        schema: {
          querystring: z.object({
            code: z.string().optional(),
            state: z.string().optional(),
            error: z.string().optional(),
            error_description: z.string().optional(),
          }),
        },
      },
      async (req, reply) => {
        const result = await c.integrations.completeAccountAuthorization(req.query);
        return reply.type('text/html; charset=utf-8').send(backToSettings(result));
      },
    );
  };
}
