import { randomBytes } from 'node:crypto';
import type { ProductionContext } from '@sbs/studio';
import type { MediaStorage } from '../media-storage';

type Fetch = typeof fetch;

/**
 * Confere um link de mídia lendo só o primeiro byte (segue redirecionamentos). Devolve o
 * problema encontrado, ou `null` se o arquivo abre, tem conteúdo e o tipo esperado.
 */
export async function checkMediaLink(
  fetchFn: Fetch,
  url: string,
  expected: 'video' | 'image',
  what: string,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { range: 'bytes=0-0' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return `${what}: o link não respondeu.`;
  }
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) return `${what}: o link respondeu ${response.status}.`;
  const type = response.headers.get('content-type') ?? '';
  const total = Number(
    response.headers.get('content-range')?.split('/')[1] ??
      response.headers.get('content-length') ??
      '0',
  );
  if (!type.startsWith(`${expected}/`))
    return `${what}: tipo "${type || '?'}", esperado ${expected}.`;
  if (!(total > 0)) return `${what}: arquivo vazio.`;
  return null;
}

/** Chave de um resultado de uma revisão da peça: `pecas/<peça>/r<revisão>/<nome>-<sorteio>.<ext>`. */
export function outputKey(context: ProductionContext, name: string, ext: string): string {
  return `pecas/${context.contentPieceId}/r${context.revisionNumber}/${name}-${randomBytes(4).toString('hex')}.${ext}`;
}

/**
 * Guarda um resultado de ferramenta no armazenamento da plataforma (os links das ferramentas
 * expiram). Resultado que já é mídia do hub (tradução do HeyGen, edição) fica como está.
 */
export async function storeOutput(
  media: Pick<MediaStorage, 'resolve'> & Partial<Pick<MediaStorage, 'isOwnLink'>>,
  fetchFn: Fetch,
  context: ProductionContext,
  name: string,
  source: { url: string } | { body: ArrayBuffer; contentType: string },
): Promise<{ url: string; stored: boolean }> {
  if ('url' in source && media.isOwnLink?.(source.url)) return { url: source.url, stored: true };
  const resolved = await media.resolve();
  if (!resolved) {
    if ('url' in source) return { url: source.url, stored: false };
    throw new Error('Armazenamento de mídia não configurado para guardar o resultado.');
  }
  let body: ArrayBuffer;
  let contentType: string;
  if ('url' in source) {
    const response = await fetchFn(source.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`não foi possível baixar o resultado (${response.status}).`);
    body = await response.arrayBuffer();
    contentType = (response.headers.get('content-type') ?? 'video/mp4').split(';')[0]!.trim();
  } else {
    ({ body, contentType } = source);
  }
  const ext = contentType.startsWith('video/') ? 'mp4' : contentType.split('/')[1] || 'bin';
  return { url: await resolved.storage.put(outputKey(context, name, ext), body, contentType), stored: true };
}

/** Baixa uma imagem para mandar à IA (base64). */
export async function downloadImage(fetchFn: Fetch, url: string) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`a imagem respondeu ${response.status}`);
  const mediaType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
  return { data: Buffer.from(await response.arrayBuffer()).toString('base64'), mediaType };
}

/**
 * Link que um serviço externo consegue baixar direto. No hub o link permanente já serve o arquivo (sem
 * redirecionar), então volta o mesmo; um link de fora que redireciona devolve o destino.
 */
export async function directUrl(fetchFn: Fetch, url: string): Promise<string> {
  try {
    const response = await fetchFn(url, {
      redirect: 'manual',
      headers: { range: 'bytes=0-0' },
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel().catch(() => undefined);
    const location = response.headers.get('location');
    return response.status >= 300 && response.status < 400 && location
      ? new URL(location, url).toString()
      : url;
  } catch {
    return url;
  }
}
