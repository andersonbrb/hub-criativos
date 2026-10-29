import {
  EditingStandardSchema,
  UpdateEditingStandardInputSchema,
  routes,
  type EditingStandard as EditingStandardDto,
} from '@sbs/contracts';
import type { EditingStandard } from '@sbs/studio';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Container } from '../../composition/container';

function toDto(standard: EditingStandard): EditingStandardDto {
  const s = standard.toSnapshot();
  return {
    guidelines: s.guidelines,
    style: s.style,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

/** Padrão de Edição: lido pelos agentes de edição, editado pelo time no painel. */
export function editingRoutes(c: Container): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      routes.getEditingStandard.path,
      { schema: { response: { 200: EditingStandardSchema } } },
      async () => toDto(await c.studio.editingStandards.get()),
    );

    app.put(
      routes.updateEditingStandard.path,
      {
        schema: {
          body: UpdateEditingStandardInputSchema,
          response: { 200: EditingStandardSchema },
        },
      },
      async (req) => toDto(await c.studio.updateEditingStandard.execute(req.body, req.user.name)),
    );
  };
}
