const HANDLE_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;

/**
 * Prévia do @ a partir do que a pessoa digitou ou colou (link do perfil ou @usuario).
 * Espelha a normalização do servidor, que é quem decide; `null` quando não é um @ válido.
 */
export function parseInstagramHandle(raw: string): string | null {
  const handle = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
  return HANDLE_PATTERN.test(handle) ? handle.toLowerCase() : null;
}

export function instagramProfileUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}
