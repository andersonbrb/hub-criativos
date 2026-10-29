import {
  ChannelSchema,
  ContentPieceSchema,
  ConnectIntegrationInputSchema,
  ContentPieceSummarySchema,
  CreateChannelInputSchema,
  CreateMarketInputSchema,
  CreateReferenceSourceInputSchema,
  DashboardSchema,
  EditingStandardSchema,
  FloraImageModelsSchema,
  DemoDataSummarySchema,
  InstagramAuthorizeResultSchema,
  IntegrationStatusSchema,
  DecisionInputSchema,
  EditCaptionInputSchema,
  MarketSchema,
  PublicationSchema,
  ReferencePostSchema,
  ReferenceSourceConnectionInputSchema,
  ReferenceSourceSchema,
  RescheduleInputSchema,
  UpdateEditingStandardInputSchema,
  SelectReferencePostInputSchema,
  SelectTopResultSchema,
  SyncResultSchema,
  UpdateMarketInputSchema,
  UpdatePostingPlanInputSchema,
  UserSchema,
  type ContentPieceFilter,
  type CreateChannelInput,
  type CreateMarketInput,
  type CreateReferenceSourceInput,
  type DecisionInput,
  type EditCaptionInput,
  type IntegrationId,
  type PublicationFilter,
  type ReferencePostStatus,
  type RescheduleInput,
  type SelectReferencePostInput,
  type UpdateEditingStandardInput,
  type UpdateMarketInput,
  type UpdatePostingPlanInput,
} from '@sbs/contracts';
import { z } from 'zod';
import { request } from './client';
import { ApiError, CLIENT_ERROR_CODES } from './errors';

/**
 * Valida a entrada com o esquema do contrato antes de enviar. Erros viram
 * `ApiError('invalid_input')` com `details.fieldErrors`, igual a um 400 da API.
 */
function validateInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_';
    fieldErrors[key] ??= issue.message;
  }
  throw new ApiError(CLIENT_ERROR_CODES.invalidInput, 'Revise os campos destacados.', null, {
    fieldErrors,
  });
}

export interface ReferencePostFilter {
  status?: ReferencePostStatus;
}

/** Uma função por rota de `routes`. Respostas validadas com os esquemas do contrato. */
export const api = {
  me: () => request('me', { schema: UserSchema }),

  dashboard: () => request('dashboard', { schema: DashboardSchema }),

  listMarkets: () => request('listMarkets', { schema: z.array(MarketSchema) }),
  createMarket: async (input: CreateMarketInput) =>
    request('createMarket', {
      body: validateInput(CreateMarketInputSchema, input),
      schema: MarketSchema,
    }),
  updateMarket: async (id: string, input: UpdateMarketInput) =>
    request('updateMarket', {
      params: { id },
      body: validateInput(UpdateMarketInputSchema, input),
      schema: MarketSchema,
    }),

  listChannels: () => request('listChannels', { schema: z.array(ChannelSchema) }),
  createChannel: async (input: CreateChannelInput) =>
    request('createChannel', {
      body: validateInput(CreateChannelInputSchema, input),
      schema: ChannelSchema,
    }),
  updatePostingPlan: async (id: string, input: UpdatePostingPlanInput) =>
    request('updatePostingPlan', {
      params: { id },
      body: validateInput(UpdatePostingPlanInputSchema, input),
      schema: ChannelSchema,
    }),

  listReferenceSources: () =>
    request('listReferenceSources', { schema: z.array(ReferenceSourceSchema) }),
  listReferencePosts: (filter: ReferencePostFilter = {}) =>
    request('listReferencePosts', {
      query: { status: filter.status },
      schema: z.array(ReferencePostSchema),
    }),
  syncReference: () => request('syncReference', { schema: SyncResultSchema }),
  selectTopReference: () => request('selectTopReference', { schema: SelectTopResultSchema }),
  selectReferencePost: (id: string, input?: SelectReferencePostInput) =>
    request('selectReferencePost', {
      params: { id },
      body: input ? validateInput(SelectReferencePostInputSchema, input) : undefined,
      schema: ReferencePostSchema,
    }),
  ignoreReferencePost: (id: string) =>
    request('ignoreReferencePost', { params: { id }, schema: ReferencePostSchema }),

  listContentPieces: (filter: ContentPieceFilter = {}) =>
    request('listContentPieces', {
      query: { status: filter.status, marketId: filter.marketId },
      schema: z.array(ContentPieceSummarySchema),
    }),
  getContentPiece: (id: string) =>
    request('getContentPiece', { params: { id }, schema: ContentPieceSchema }),
  decideContentPiece: async (id: string, input: DecisionInput) =>
    request('decideContentPiece', {
      params: { id },
      body: validateInput(DecisionInputSchema, input),
      schema: ContentPieceSchema,
    }),
  editCaption: async (id: string, input: EditCaptionInput) =>
    request('editCaption', {
      params: { id },
      body: validateInput(EditCaptionInputSchema, input),
      schema: ContentPieceSchema,
    }),
  retryContentPiece: (id: string) =>
    request('retryContentPiece', { params: { id }, schema: ContentPieceSchema }),

  listPublications: (filter: PublicationFilter = {}) =>
    request('listPublications', {
      query: { from: filter.from, to: filter.to, channelId: filter.channelId },
      schema: z.array(PublicationSchema),
    }),
  reschedulePublication: async (id: string, input: RescheduleInput) =>
    request('reschedulePublication', {
      params: { id },
      body: validateInput(RescheduleInputSchema, input),
      schema: PublicationSchema,
    }),
  cancelPublication: (id: string) =>
    request('cancelPublication', { params: { id }, schema: PublicationSchema }),

  createReferenceSource: async (input: CreateReferenceSourceInput) =>
    request('createReferenceSource', {
      body: validateInput(CreateReferenceSourceInputSchema, input),
      schema: ReferenceSourceSchema,
    }),
  updateReferenceSourceConnection: async (id: string, connected: boolean) =>
    request('updateReferenceSourceConnection', {
      params: { id },
      body: validateInput(ReferenceSourceConnectionInputSchema, { connected }),
      schema: ReferenceSourceSchema,
    }),
  syncReferenceSource: (id: string) =>
    request('syncReferenceSource', { params: { id }, schema: SyncResultSchema }),

  getEditingStandard: () => request('getEditingStandard', { schema: EditingStandardSchema }),
  updateEditingStandard: (input: UpdateEditingStandardInput) =>
    request('updateEditingStandard', {
      body: validateInput(UpdateEditingStandardInputSchema, input),
      schema: EditingStandardSchema,
    }),

  floraImageModels: () => request('floraImageModels', { schema: FloraImageModelsSchema }),
  listIntegrations: () => request('listIntegrations', { schema: z.array(IntegrationStatusSchema) }),
  connectIntegration: async (id: IntegrationId, values: Record<string, string>) =>
    request('connectIntegration', {
      params: { id },
      body: validateInput(ConnectIntegrationInputSchema, { values }),
      schema: IntegrationStatusSchema,
    }),
  disconnectIntegration: (id: IntegrationId) =>
    request('disconnectIntegration', { params: { id }, schema: IntegrationStatusSchema }),
  authorizeInstagramAccount: (marketId: string, origin: string) =>
    request('authorizeInstagramAccount', {
      body: { origin, marketId },
      schema: InstagramAuthorizeResultSchema,
    }),
  changeInstagramChannelMarket: (channelId: string, marketId: string) =>
    request('changeInstagramChannelMarket', {
      params: { channelId },
      body: { marketId },
      schema: IntegrationStatusSchema,
    }),
  setInstagramChannelPublishing: (channelId: string, enabled: boolean) =>
    request('setInstagramChannelPublishing', {
      params: { channelId },
      body: { enabled },
      schema: IntegrationStatusSchema,
    }),
  disconnectInstagramChannel: (channelId: string) =>
    request('disconnectInstagramChannel', {
      params: { channelId },
      schema: IntegrationStatusSchema,
    }),

  demoDataSummary: () => request('demoDataSummary', { schema: DemoDataSummarySchema }),
  purgeDemoData: () => request('purgeDemoData', { schema: DemoDataSummarySchema }),
} as const;

export type Api = typeof api;
