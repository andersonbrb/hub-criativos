import type { User } from '@sbs/contracts';

import { bancoDeTeste } from '@/db/teste';
import type { NomeDaChave } from '@/features/integracoes/contrato';

import type { PlatformConfig } from '../composition/container';
import { encodeUser, USER_HEADER } from '../composition/current-user';
import type { Database } from '../infrastructure/database/postgres-document-store';

/** Banco do hub em memória (PGlite, com a organização padrão), como nos testes das outras funcionalidades. */
export async function openTestDatabase(): Promise<{ db: () => Database; close(): Promise<void> }> {
  const db = await bancoDeTeste();
  return { db: () => db, close: async () => undefined };
}

/**
 * Plataforma de teste: sem mídia guardada (a etapa de armazenamento é pulada, como no projeto de origem sem bucket),
 * sem editor de vídeo e sem transcrição; as chaves do hub vêm de `keys` e nenhum login de MCP está ativo.
 */
export function testPlatform(
  overrides: Partial<Omit<PlatformConfig, 'integrations'>> & {
    keys?: Partial<Record<NomeDaChave, string>>;
    mcp?: Partial<Record<'heygen' | 'elevenlabs' | 'flora', boolean>>;
    fetch?: typeof fetch;
  } = {},
): PlatformConfig {
  const { keys = {}, mcp = {}, fetch: fetchFn, ...rest } = overrides;
  return {
    production: false,
    referencePostsLimit: 50,
    media: { publicUrl: 'http://hub.test', secret: 'segredo-de-teste', enabled: false },
    transcriber: null,
    ...rest,
    integrations: {
      publicUrl: 'http://hub.test',
      hub: {
        key: async (name) => keys[name] ?? null,
        mcpActive: async (service) => ({ active: Boolean(mcp[service]), account: mcp[service] ? `conta ${service}` : null }),
      },
      ...(fetchFn ? { fetch: fetchFn } : {}),
    },
  };
}

const USERS: Record<User['role'], User> = {
  admin: { id: 'user-admin', name: 'Administrador', email: 'admin@hub.test', role: 'admin' },
  reviewer: { id: 'user-reviewer', name: 'Social Media', email: 'social@hub.test', role: 'reviewer' },
};

/** O cabeçalho que a rota do hub põe com a pessoa logada (no lugar do antigo `x-demo-role`). */
export const asUser = (role: string = 'admin') => ({
  [USER_HEADER]: encodeUser(USERS[role === 'reviewer' ? 'reviewer' : 'admin']),
});
