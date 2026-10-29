import type { ContentPieceFilter, PublicationFilter } from '@sbs/contracts';
import type { ReferencePostFilter } from './endpoints';

/**
 * Fábrica de chaves do TanStack Query. Cada recurso tem uma raiz (`all`) para
 * invalidar tudo de uma vez depois de uma mutação.
 */
export const queryKeys = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  demoData: ['admin', 'demo-data'] as const,
  integrations: ['integrations'] as const,
  editingStandard: ['editing-standard'] as const,
  floraImageModels: ['integrations', 'flora', 'models'] as const,
  markets: {
    all: ['markets'] as const,
  },
  channels: {
    all: ['channels'] as const,
  },
  reference: {
    all: ['reference'] as const,
    sources: ['reference', 'sources'] as const,
    posts: (filter: ReferencePostFilter = {}) => ['reference', 'posts', filter] as const,
  },
  contentPieces: {
    all: ['content-pieces'] as const,
    lists: ['content-pieces', 'list'] as const,
    list: (filter: ContentPieceFilter = {}) => ['content-pieces', 'list', filter] as const,
    detail: (id: string) => ['content-pieces', 'detail', id] as const,
  },
  publications: {
    all: ['publications'] as const,
    list: (filter: PublicationFilter = {}) => ['publications', 'list', filter] as const,
  },
} as const;
