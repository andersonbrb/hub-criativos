import type { User } from '@sbs/contracts';

/**
 * Quem está usando o Instagram, vindo do login do hub: a rota do hub põe a pessoa neste cabeçalho (JSON em base64url)
 * e apaga qualquer valor que tenha vindo do navegador. Dono e admin da organização são `admin` (mercados, contas,
 * publicação real e Padrão de Edição); os demais com a tela Instagram são `reviewer` (o social media).
 */
export const USER_HEADER = 'x-instagram-usuario';

const ANONYMOUS: User = { id: 'desconhecido', name: 'Revisor', email: 'revisor@hub.local', role: 'reviewer' };

export function encodeUser(user: User): string {
  return Buffer.from(JSON.stringify(user)).toString('base64url');
}

export function resolveCurrentUser(header: string | string[] | undefined): User {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return ANONYMOUS;
  try {
    const user = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<User>;
    return {
      id: String(user.id ?? ANONYMOUS.id),
      name: String(user.name ?? ANONYMOUS.name),
      email: String(user.email ?? ANONYMOUS.email),
      role: user.role === 'admin' ? 'admin' : 'reviewer',
    };
  } catch {
    return ANONYMOUS;
  }
}
