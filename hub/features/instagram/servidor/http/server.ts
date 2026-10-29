import { DashboardSchema, UserSchema, routes, type User } from '@sbs/contracts';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Container } from '../composition/container';
import { resolveCurrentUser, USER_HEADER } from '../composition/current-user';
import { errorHandler } from './error-handler';
import { adminRoutes } from './routes/admin-routes';
import { contentRoutes } from './routes/content-routes';
import { editingRoutes } from './routes/editing-routes';
import { integrationsRoutes } from './routes/integrations-routes';
import { marketsRoutes } from './routes/markets-routes';
import { publishingRoutes } from './routes/publishing-routes';
import { referenceRoutes } from './routes/reference-routes';

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

/**
 * As rotas do Instagram, as mesmas do projeto de origem, num Fastify que nunca escuta porta: a rota do hub
 * (app/api/instagram/[...caminho]) confere o login e a tela, e repassa cada pedido com `inject`, dentro da
 * organização aberta. Quem chama é o hub, que põe a pessoa no cabeçalho `x-instagram-usuario`.
 */
export async function buildServer(container: Container) {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  app.decorateRequest('user', null as unknown as User);
  app.addHook('onRequest', async (req) => {
    req.user = resolveCurrentUser(req.headers[USER_HEADER]);
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get(routes.me.path, { schema: { response: { 200: UserSchema } } }, async (req) => req.user);
  app.get(routes.dashboard.path, { schema: { response: { 200: DashboardSchema } } }, () =>
    container.dashboard.execute(),
  );

  await app.register(marketsRoutes(container));
  await app.register(referenceRoutes(container));
  await app.register(contentRoutes(container));
  await app.register(publishingRoutes(container));
  await app.register(editingRoutes(container));
  await app.register(adminRoutes(container));
  await app.register(integrationsRoutes(container));

  await app.ready();
  return app;
}

export type Server = Awaited<ReturnType<typeof buildServer>>;
