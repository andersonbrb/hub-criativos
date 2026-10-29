import { createHash, createHmac } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import type { PollingOptions } from './polling';
import { IntegrationCheckError } from './provider-checks';

type Fetch = typeof fetch;
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Gateway da vMake (configuração e cota), o mesmo do cliente oficial para agentes. */
const WAPI = 'wapi-skill.vmake.ai';
const CLIENT_VERSION = 'v2.0.0';
const USER_AGENT = `vmake-skill-${CLIENT_VERSION}`;
const REGION = 'cn-north-4';
const ALGORITHM = 'SDK-HMAC-SHA256';

/** Tarefas da conta (catálogo devolvido pela vMake). */
export interface VmakeTask {
  id: string;
  name: string;
  task: string;
  taskType: string;
  params: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  mediaType: string;
  maxDurationSeconds: number | null;
  maxBytes: number | null;
}

/** Remoção de legendas e a remoção "inteligente" (qualquer texto na tela). */
export const VMAKE_SUBTITLE_TASK = '/v1/videosubtitle_remove_async';
export const VMAKE_SMART_REMOVAL_TASK = '/v1/videoscreenclear_async';

interface Catalog {
  gid: string;
  endpoint: string;
  tokenPolicyType: string;
  tasks: VmakeTask[];
}

interface TokenPolicy {
  api: { url: string; pushPath: string; statusPath: string; syncTimeout: number };
  upload: {
    bucket: string;
    url: string;
    region: string;
    key: string;
    data: string;
    credentials: { accessKey: string; secretKey: string; sessionToken: string };
  };
}

/**
 * Assinatura da vMake (SDK-HMAC-SHA256): todos os cabeçalhos enviados entram na assinatura,
 * o caminho termina em "/" e o Authorization vai em base64 depois de "Bearer".
 */
export function signVmakeRequest(
  credentials: { accessKey: string; secretKey: string },
  request: { url: string; method: string; headers: Record<string, string>; body: string },
  now: Date,
): Record<string, string> {
  const date = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const headers = { ...request.headers, 'X-Sdk-Date': date };
  const url = new URL(request.url);
  const signed = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
  );
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const canonical = [
    request.method,
    path,
    query,
    signed.map((k) => `${k}:${lower[k]}`).join('\n'),
    signed.join(';'),
    createHash('sha256').update(request.body).digest('hex'),
  ].join('\n');
  const toSign = `${ALGORITHM}\n${date}\n${createHash('sha256').update(canonical).digest('hex')}`;
  const signature = createHmac('sha256', credentials.secretKey).update(toSign).digest('hex');
  const value = `${ALGORITHM} Access=${credentials.accessKey}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
  return { ...headers, Authorization: `Bearer ${Buffer.from(value).toString('base64')}` };
}

/** Links devolvidos por uma tarefa concluída (mesma ordem de busca do cliente oficial). */
export function vmakeOutputUrls(body: unknown): string[] {
  const result = (body as { data?: { result?: Record<string, unknown> } })?.data?.result;
  if (!result || typeof result !== 'object') return [];
  const urls: string[] = [];
  const add = (value: unknown) => {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === 'string' && /^https?:\/\//.test(v) && !urls.includes(v)) urls.push(v);
    }
  };
  for (const key of ['urls', 'images', 'videos', 'url']) add(result[key]);
  const mediaLists = [
    result['media_info_list'],
    (result['data'] as Record<string, unknown> | undefined)?.['media_info_list'],
    (result['mtlab_res'] as Record<string, unknown> | undefined)?.['media_info_list'],
  ];
  for (const list of mediaLists) {
    if (Array.isArray(list))
      for (const item of list) add((item as { media_data?: unknown })?.media_data);
  }
  return urls;
}

/**
 * vMake: remoção de legendas e de textos de vídeos. Fluxo do cliente oficial: catálogo → envio
 * do vídeo ao armazenamento da vMake (credenciais temporárias) → registro de uso (cobra) →
 * tarefa assíncrona → acompanhamento até o vídeo ficar pronto.
 */
export class VmakeClient {
  private readonly fetchFn: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private catalogCache: Promise<Catalog> | null = null;

  constructor(
    private readonly credentials: { accessKey: string; secretKey: string },
    options: PollingOptions = {},
  ) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? realSleep;
    this.pollMs = options.pollMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 60 * 60_000;
  }

  /** Tarefas disponíveis na conta. */
  async tasks(): Promise<VmakeTask[]> {
    return (await this.catalog()).tasks;
  }

  /** Remove legendas (ou, com `smart`, todo texto na tela) e devolve o link do vídeo pronto. */
  async removeSubtitles(input: {
    video: ArrayBuffer;
    contentType: string;
    smart?: boolean;
  }): Promise<{ videoUrl: string; taskName: string }> {
    const catalog = await this.catalog();
    const wanted = input.smart ? VMAKE_SMART_REMOVAL_TASK : VMAKE_SUBTITLE_TASK;
    const task = catalog.tasks.find((t) => t.task === wanted);
    if (!task) {
      throw new IntegrationCheckError(
        `A conta da vMake não tem a tarefa "${input.smart ? 'remoção inteligente' : 'remoção de legendas'}".`,
      );
    }
    if (task.maxBytes && input.video.byteLength > task.maxBytes) {
      throw new IntegrationCheckError(
        `O vídeo passa do limite da vMake (${Math.round(task.maxBytes / 1_048_576)} MB).`,
      );
    }

    const policy = await this.tokenPolicy(catalog);
    const sourceUrl = await this.upload(policy, input.video, input.contentType);
    const consumed = await this.wapi('/skill/consume.json', {
      url: sourceUrl,
      task: task.id,
      gid: catalog.gid,
    });
    const context = typeof consumed['context'] === 'string' ? consumed['context'] : '';
    const output = await this.run(policy, task, sourceUrl, context);
    return { videoUrl: output, taskName: task.name };
  }

  private catalog(): Promise<Catalog> {
    this.catalogCache ??= this.loadCatalog().catch((error: unknown) => {
      this.catalogCache = null;
      throw error;
    });
    return this.catalogCache;
  }

  private async loadCatalog(): Promise<Catalog> {
    const response = await this.wapi('/skill/config.json', {
      gid: '',
      version: CLIENT_VERSION,
      supported_schemas: ['v2', 'v1'],
    });
    const algorithm = (response['algorithm'] ?? {}) as Record<string, unknown>;
    const regions = (algorithm['regions'] ?? {}) as Record<string, string>;
    const endpoint = regions[REGION];
    if (!endpoint) throw new IntegrationCheckError('A vMake não informou o endereço das tarefas.');
    const invoke = (algorithm['invoke'] ?? {}) as Record<string, Record<string, unknown>>;
    const tasks = Object.entries(invoke).map(([id, t]): VmakeTask => ({
      id,
      name: typeof t['name'] === 'string' ? t['name'] : id,
      task: String(t['task'] ?? ''),
      taskType: typeof t['task_type'] === 'string' && t['task_type'] ? t['task_type'] : 'mtlab',
      params: (t['params'] as Record<string, unknown> | null) ?? {},
      profile: (t['profile'] as Record<string, unknown> | undefined) ?? null,
      mediaType: String(t['media_type'] ?? ''),
      maxDurationSeconds: typeof t['max_duration'] === 'number' ? t['max_duration'] : null,
      maxBytes: typeof t['max_size'] === 'number' ? t['max_size'] : null,
    }));
    return {
      gid: typeof response['gid'] === 'string' ? response['gid'] : '',
      endpoint,
      tokenPolicyType:
        typeof algorithm['token_policy_type'] === 'string'
          ? algorithm['token_policy_type']
          : 'mtai',
      tasks,
    };
  }

  private async tokenPolicy(catalog: Catalog): Promise<TokenPolicy> {
    const url = `https://${catalog.endpoint}/ai/token_policy?type=${encodeURIComponent(catalog.tokenPolicyType)}`;
    const body = await this.signedJson(url, 'GET', { Host: catalog.endpoint }, '');
    const mtai = ((body['data'] as Record<string, unknown> | undefined)?.['mtai'] ?? {}) as Record<
      string,
      { order?: string[] } & Record<string, unknown>
    >;
    const pick = (group: string) => {
      const section = mtai[group];
      const name = section?.order?.[0];
      return (name ? section?.[name] : null) as Record<string, unknown> | null;
    };
    const api = pick('api');
    const upload = pick('upload');
    if (!api || !upload) throw new IntegrationCheckError('A vMake não liberou o envio do vídeo.');
    const creds = (upload['credentials'] ?? {}) as Record<string, string>;
    return {
      api: {
        url: String(api['url']),
        pushPath: String(api['push_path']),
        statusPath: String(
          (api['status_query'] as Record<string, unknown> | undefined)?.['path'] ??
            api['status_path'],
        ),
        syncTimeout: Number(api['sync_timeout'] ?? 15),
      },
      upload: {
        bucket: String(upload['bucket']),
        url: String(upload['url']),
        region: String(upload['region']),
        key: String(upload['key']),
        data: String(upload['data']),
        credentials: {
          accessKey: creds['access_key'] ?? '',
          secretKey: creds['secret_key'] ?? '',
          sessionToken: creds['session_token'] ?? '',
        },
      },
    };
  }

  /** Envia o vídeo ao armazenamento da vMake (compatível com S3) e devolve o link dele. */
  private async upload(policy: TokenPolicy, video: ArrayBuffer, contentType: string) {
    const { upload } = policy;
    const client = new AwsClient({
      accessKeyId: upload.credentials.accessKey,
      secretAccessKey: upload.credentials.secretKey,
      ...(upload.credentials.sessionToken ? { sessionToken: upload.credentials.sessionToken } : {}),
      service: 's3',
      region: upload.region,
    });
    const target = `https://${upload.bucket}.${new URL(upload.url).host}/${upload.key}`;
    let response: Response;
    try {
      const signed = await client.sign(target, {
        method: 'PUT',
        body: video,
        headers: { 'content-type': contentType },
      });
      response = await this.fetchFn(signed);
    } catch {
      throw new IntegrationCheckError('Não foi possível enviar o vídeo para a vMake.');
    }
    if (!response.ok) {
      throw new IntegrationCheckError(`A vMake recusou o envio do vídeo (${response.status}).`);
    }
    return upload.data;
  }

  private async run(policy: TokenPolicy, task: VmakeTask, sourceUrl: string, context: string) {
    const host = new URL(policy.api.url).host;
    const body = {
      params: JSON.stringify(task.params ?? {}),
      context,
      task: task.task,
      task_type: task.taskType,
      sync_timeout: policy.api.syncTimeout,
      init_images: [task.profile ? { url: sourceUrl, profile: task.profile } : { url: sourceUrl }],
    };
    const submitted = await this.signedJson(
      `${policy.api.url}/${policy.api.pushPath}`,
      'POST',
      { Host: host },
      JSON.stringify(body),
    );
    failIfError(submitted);
    const data = (submitted['data'] ?? {}) as Record<string, unknown>;
    if (data['status'] !== 9) return firstOutput(submitted);
    const taskId = String((data['result'] as Record<string, unknown> | undefined)?.['id'] ?? '');
    if (!taskId) throw new IntegrationCheckError('A vMake não devolveu o id da tarefa.');

    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      await this.sleep(this.pollMs);
      const status = await this.signedJson(
        `${policy.api.url}/${policy.api.statusPath}?task_id=${encodeURIComponent(taskId)}`,
        'GET',
        { Host: host },
        '',
      );
      failIfError(status);
      const state = (status['data'] as Record<string, unknown> | undefined)?.['status'];
      if (state === 10 || state === 2 || state === 20) return firstOutput(status);
      if (state === 3) throw new IntegrationCheckError('A vMake não conseguiu processar o vídeo.');
      if (Date.now() > deadline) {
        throw new IntegrationCheckError('A remoção de legendas na vMake passou do tempo limite.');
      }
    }
  }

  /** Chamada ao gateway (configuração e cota): devolve o campo `response`. */
  private async wapi(path: string, payload: unknown): Promise<Record<string, unknown>> {
    const body = await this.signedJson(
      `https://${WAPI}${path}`,
      'POST',
      { 'Content-Type': 'application/json' },
      JSON.stringify(payload),
    );
    const meta = (body['meta'] ?? {}) as { code?: unknown; msg?: unknown };
    if (meta.code !== undefined && meta.code !== 0 && meta.code !== '0') {
      const message =
        typeof meta.msg === 'string' && meta.msg ? meta.msg : `código ${String(meta.code)}`;
      throw new IntegrationCheckError(`A vMake recusou o pedido: ${message}.`);
    }
    return (body['response'] ?? {}) as Record<string, unknown>;
  }

  private async signedJson(
    url: string,
    method: 'GET' | 'POST',
    extra: Record<string, string>,
    body: string,
  ): Promise<Record<string, unknown>> {
    const headers = signVmakeRequest(
      this.credentials,
      { url, method, headers: { ...extra, 'User-Agent': USER_AGENT }, body },
      new Date(),
    );
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        // Buffer: o fetch não acrescenta um Content-Type que ficaria fora da assinatura.
        ...(method === 'POST' ? { body: Buffer.from(body) } : {}),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new IntegrationCheckError('Sem resposta da vMake. Tente de novo.');
    }
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new IntegrationCheckError('A vMake recusou as chaves. Confira em Integrações.');
    }
    if (!response.ok) {
      throw new IntegrationCheckError(`A vMake respondeu ${response.status}.`);
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new IntegrationCheckError('A vMake respondeu num formato inesperado.');
    }
  }
}

function failIfError(body: Record<string, unknown>) {
  const meta = body['meta'] as { code?: unknown; msg?: unknown } | undefined;
  if (meta && meta.code !== undefined && meta.code !== 0 && meta.code !== '0') {
    const message =
      typeof meta.msg === 'string' && meta.msg ? meta.msg : `código ${String(meta.code)}`;
    throw new IntegrationCheckError(`A vMake não conseguiu processar o vídeo: ${message}.`);
  }
}

function firstOutput(body: Record<string, unknown>): string {
  const [url] = vmakeOutputUrls(body);
  if (!url) throw new IntegrationCheckError('A vMake concluiu sem devolver o vídeo.');
  return url;
}

/** Confere o par de chaves pedindo o catálogo; exige a tarefa de remoção de legendas. */
export async function checkVmake(
  accessKey: string,
  secretKey: string,
  fetchFn: Fetch = fetch,
): Promise<{ account: string | null }> {
  const tasks = await new VmakeClient({ accessKey, secretKey }, { fetch: fetchFn }).tasks();
  if (!tasks.some((t) => t.task === VMAKE_SUBTITLE_TASK)) {
    throw new IntegrationCheckError('Esta conta da vMake não tem a remoção de legendas pela API.');
  }
  return { account: `${tasks.length} tarefas na API, com remoção de legendas` };
}
