/**
 * Catálogo de rotas HTTP da API. O painel e a API usam a mesma lista,
 * então uma rota renomeada quebra a compilação dos dois lados.
 *
 * Todas as respostas de erro seguem `ApiErrorSchema`.
 */
export const routes = {
  me: { method: 'GET', path: '/me' },

  dashboard: { method: 'GET', path: '/dashboard' },

  listMarkets: { method: 'GET', path: '/markets' },
  createMarket: { method: 'POST', path: '/markets' },
  updateMarket: { method: 'PATCH', path: '/markets/:id' },

  listChannels: { method: 'GET', path: '/channels' },
  createChannel: { method: 'POST', path: '/channels' },
  updatePostingPlan: { method: 'PUT', path: '/channels/:id/posting-plan' },

  listReferenceSources: { method: 'GET', path: '/reference/sources' },
  createReferenceSource: { method: 'POST', path: '/reference/sources' },
  updateReferenceSourceConnection: { method: 'PUT', path: '/reference/sources/:id/connection' },
  syncReferenceSource: { method: 'POST', path: '/reference/sources/:id/sync' },
  listReferencePosts: { method: 'GET', path: '/reference/posts' },
  syncReference: { method: 'POST', path: '/reference/sync' },
  selectTopReference: { method: 'POST', path: '/reference/select-top' },
  selectReferencePost: { method: 'POST', path: '/reference/posts/:id/select' },
  ignoreReferencePost: { method: 'POST', path: '/reference/posts/:id/ignore' },

  listContentPieces: { method: 'GET', path: '/content-pieces' },
  getContentPiece: { method: 'GET', path: '/content-pieces/:id' },
  decideContentPiece: { method: 'POST', path: '/content-pieces/:id/decision' },
  editCaption: { method: 'PUT', path: '/content-pieces/:id/caption' },
  retryContentPiece: { method: 'POST', path: '/content-pieces/:id/retry' },

  listPublications: { method: 'GET', path: '/publications' },
  reschedulePublication: { method: 'PATCH', path: '/publications/:id' },
  cancelPublication: { method: 'POST', path: '/publications/:id/cancel' },

  listIntegrations: { method: 'GET', path: '/integrations' },
  floraImageModels: { method: 'GET', path: '/integrations/flora/models' },
  /** Link permanente de um arquivo de mídia (redireciona para o bucket). Público. */
  mediaFile: { method: 'GET', path: '/media/:signature/*' },
  connectIntegration: { method: 'PUT', path: '/integrations/:id' },
  disconnectIntegration: { method: 'DELETE', path: '/integrations/:id' },
  authorizeInstagramAccount: { method: 'POST', path: '/integrations/instagram/authorize' },
  changeInstagramChannelMarket: {
    method: 'PUT',
    path: '/integrations/instagram/channels/:channelId/market',
  },
  setInstagramChannelPublishing: {
    method: 'PUT',
    path: '/integrations/instagram/channels/:channelId/publishing',
  },
  disconnectInstagramChannel: {
    method: 'DELETE',
    path: '/integrations/instagram/channels/:channelId',
  },
  instagramCallback: { method: 'GET', path: '/integrations/instagram/callback' },

  getEditingStandard: { method: 'GET', path: '/editing-standard' },
  updateEditingStandard: { method: 'PUT', path: '/editing-standard' },

  demoDataSummary: { method: 'GET', path: '/admin/demo-data' },
  purgeDemoData: { method: 'DELETE', path: '/admin/demo-data' },
} as const;

export type RouteName = keyof typeof routes;

/** Preenche `:param` no caminho: `buildPath('/markets/:id', { id: 'x' })` → `/markets/x`. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Parâmetro de rota ausente: ${key}`);
    return encodeURIComponent(value);
  });
}
