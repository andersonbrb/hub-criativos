import { DemoDataSummarySchema, routes } from '@sbs/contracts';
import { DomainError } from '@sbs/shared-kernel';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../../composition/container';
import { importData } from '../../composition/data-import';

const ImportInputSchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.string().min(1).max(60),
        id: z.string().min(1).max(200),
        version: z.number().int().positive(),
        data: z.record(z.string(), z.unknown()),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    )
    .max(20_000),
  events: z
    .array(z.object({ type: z.string().min(1).max(80), occurredAt: z.string(), payload: z.unknown() }))
    .max(100_000),
});

/** Manutenção da plataforma: exclusiva do admin. */
export function adminRoutes(c: Container): FastifyPluginAsyncZod {
  return async (app) => {
    const requireAdmin = (role: string) => {
      if (role !== 'admin')
        throw new DomainError('forbidden', 'Apenas administradores podem remover dados.');
    };

    app.get(
      routes.demoDataSummary.path,
      { schema: { response: { 200: DemoDataSummarySchema } } },
      async (req) => {
        requireAdmin(req.user.role);
        return c.demoData.summary();
      },
    );

    // Traz os dados do projeto de origem para a organização aberta (composition/data-import.ts).
    app.post(
      '/admin/import',
      {
        bodyLimit: 50 * 1024 * 1024,
        schema: {
          body: ImportInputSchema,
          response: { 200: z.object({ documents: z.number(), skippedDocuments: z.number(), events: z.number() }) },
        },
      },
      async (req) => {
        requireAdmin(req.user.role);
        return importData(c.db(), req.body);
      },
    );

    // Remove os posts de exemplo e tudo que derivou deles; devolve o que foi apagado.
    app.delete(
      routes.purgeDemoData.path,
      { schema: { response: { 200: DemoDataSummarySchema } } },
      async (req) => {
        requireAdmin(req.user.role);
        return c.demoData.purge();
      },
    );
  };
}
