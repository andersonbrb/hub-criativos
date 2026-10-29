import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { ORGANIZACAO_PADRAO } from '@/features/acesso/contrato';
import { modoLocalSemBanco } from '@/features/acesso/modo-local';
import { comOrganizacao, ehIdDeOrganizacao, organizacaoDoContexto } from '@/features/acesso/servicos/organizacao-atual';
import { concluirComArquivo, exigirDriveParaVideo } from '@/features/drive/servicos/videos';
import type { Generation, MediaKind } from '@/lib/generations';
import { saveMedia } from '@/lib/server/media';
import { servirArquivoDeMidia } from '@/lib/server/servir-midia';
import { createGeneration, listGenerations } from '@/lib/server/store';

/** O que a linha de produção precisa de um armazenamento: gravar, saber se já tem e o link permanente. */
export interface MediaStore {
  put(key: string, body: ArrayBuffer | string, contentType: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  publicUrl(key: string): string;
}

export interface MediaStorageConfig {
  /** Endereço público do hub (HUB_PUBLIC_URL), base dos links `/api/instagram/midia/...`. */
  publicUrl: string;
  /** Chave das assinaturas dos links. */
  secret: string;
  /** Só testes: `false` deixa a linha sem armazenamento (a etapa de armazenamento é pulada). */
  enabled?: boolean;
}

export const MEDIA_ROUTE = '/api/instagram/midia/';

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
};

/** Chave das assinaturas: derivada da chave de segredos do hub (fixa entre reinícios, como os links). */
export function mediaSecret(): string {
  const base = process.env.HUB_CHAVE_SEGREDOS?.trim() || 'instagram-midia-somente-no-pc';
  return createHash('sha256').update(`instagram-midia:${base}`).digest('base64url');
}

/**
 * Onde a mídia das adaptações fica no hub, pela regra do dono: vídeo só no Google Drive da organização (pasta
 * "Instagram"), imagem e áudio no disco do hub. Cada arquivo vira uma geração do hub (tool "instagram"), com a chave
 * da linha de produção em params.instagramChave, e ganha um link permanente e público:
 * `<hub>/api/instagram/midia/<organização>/<assinatura>/<chave>`. A assinatura (HMAC) impede adivinhar links; é o
 * link que o Instagram, a vMake, o HeyGen e o FLORA baixam.
 */
export class MediaStorage {
  private readonly store: MediaStore;

  constructor(private readonly config: MediaStorageConfig) {
    this.store = {
      put: (key, body, contentType) => this.put(key, body, contentType),
      exists: async (key) => (await this.generationFor(key)) !== null,
      publicUrl: (key) => this.urlFor(currentOrg(), key),
    };
  }

  /** Sempre pronto no hub (o vídeo ainda depende do Drive conectado, conferido ao gravar). */
  get railwayConfigured(): boolean {
    return this.config.enabled !== false;
  }

  async resolve(): Promise<{ storage: MediaStore; label: string } | null> {
    if (this.config.enabled === false) return null;
    return { storage: this.store, label: 'armazenamento do hub (vídeo no Google Drive)' };
  }

  /** O link é da mídia guardada aqui? (a busca local evita o caminho de ida e volta pela internet) */
  isOwnLink(url: string): boolean {
    return url.startsWith(`${this.base()}${MEDIA_ROUTE}`);
  }

  /** Link permanente de uma chave da organização em que o código está rodando. */
  publicUrl(key: string): string {
    return this.urlFor(currentOrg(), key);
  }

  /** A geração do hub por trás de um link da mídia do Instagram (null: link de fora ou assinatura que não confere). */
  async generationOf(url: string): Promise<Generation | null> {
    if (!this.isOwnLink(url)) return null;
    const parsed = this.parse(url);
    if (!parsed) return null;
    return comOrganizacao(parsed.org, () => this.generationFor(parsed.key));
  }

  /** Rota pública do link: confere a assinatura e serve o arquivo da organização do link (Range incluído). */
  async serve(request: Request, url: string): Promise<Response> {
    const parsed = this.parse(url);
    if (!parsed) return notFound();
    return comOrganizacao(parsed.org, async () => {
      const generation = await this.generationFor(parsed.key);
      if (!generation?.file) return notFound();
      return servirArquivoDeMidia(request, generation.file, { teto: false });
    });
  }

  private base(): string {
    return this.config.publicUrl.replace(/\/+$/, '');
  }

  private urlFor(org: string, key: string): string {
    return `${this.base()}${MEDIA_ROUTE}${org}/${this.sign(org, key)}/${encodeKey(key)}`;
  }

  private parse(url: string): { org: string; key: string } | null {
    const path = new URL(url, this.base()).pathname;
    if (!path.startsWith(MEDIA_ROUTE)) return null;
    const [org, signature, ...rest] = path.slice(MEDIA_ROUTE.length).split('/');
    if (!org || !signature || rest.length === 0 || !ehIdDeOrganizacao(org)) return null;
    let key: string;
    try {
      key = rest.map(decodeURIComponent).join('/');
    } catch {
      return null;
    }
    const expected = Buffer.from(this.sign(org, key));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { org, key };
  }

  private sign(org: string, key: string): string {
    return createHmac('sha256', this.config.secret)
      .update(`media:${org}:${key}`)
      .digest('base64url')
      .slice(0, 32);
  }

  private async put(key: string, body: ArrayBuffer | string, contentType: string): Promise<string> {
    const type = contentType.split(';')[0]!.trim().toLowerCase();
    const kind: MediaKind = type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'image';
    // Regra do dono: vídeo só no Drive. Sem Drive conectado, a etapa falha com o aviso de conectar.
    if (kind === 'video') await exigirDriveParaVideo();
    const ext = EXTENSIONS[type] ?? key.split('.').pop()?.toLowerCase() ?? (kind === 'video' ? 'mp4' : 'jpg');
    const file = await saveMedia(typeof body === 'string' ? Buffer.from(body) : body, ext);
    const name = key.split('/').slice(-2).join(' · ');
    const generation = await createGeneration({
      tool: 'instagram',
      kind,
      status: 'running',
      prompt: `Instagram: ${key}`,
      name: `Instagram · ${name}`,
      params: { instagramChave: key },
    });
    await concluirComArquivo(generation.id, { file });
    return this.urlFor(currentOrg(), key);
  }

  /** A geração mais nova com esta chave, pronta (a última gravação vale). */
  private async generationFor(key: string): Promise<Generation | null> {
    const found = (await listGenerations('instagram'))
      .filter((g) => g.params['instagramChave'] === key && g.status === 'done' && g.file)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return found[0] ?? null;
  }
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function currentOrg(): string {
  const org = organizacaoDoContexto() ?? (modoLocalSemBanco() ? ORGANIZACAO_PADRAO.id : null);
  if (!org) throw new Error('Mídia do Instagram fora de uma organização.');
  return org;
}

const notFound = () =>
  new Response('Arquivo não encontrado.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * O `fetch` das ferramentas: o link da própria mídia é servido aqui mesmo (sem sair pela internet e voltar; no PC,
 * localhost não chega de fora); qualquer outro endereço vai pela rede.
 */
export function hubFetch(media: MediaStorage, base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!media.isOwnLink(url)) return base(input, init);
    const request = new Request(url, { method: init?.method ?? 'GET', headers: init?.headers });
    if (init?.redirect === 'manual') {
      // directUrl pergunta para onde o link redireciona: aqui ele mesmo é o arquivo.
      return new Response(null, { status: 200 });
    }
    return media.serve(request, url);
  }) as typeof fetch;
}
