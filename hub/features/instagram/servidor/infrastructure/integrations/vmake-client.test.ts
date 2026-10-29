import { describe, expect, it, vi } from 'vitest';
import { VmakeClient, signVmakeRequest, vmakeOutputUrls } from './vmake-client';

const creds = { accessKey: 'AK123', secretKey: 'SK456' };

describe('signVmakeRequest', () => {
  it('assina todos os cabeçalhos e manda o Authorization em base64', () => {
    const headers = signVmakeRequest(
      creds,
      {
        url: 'https://wapi-skill.vmake.ai/skill/config.json',
        method: 'POST',
        headers: { 'User-Agent': 'vmake-skill-v2.0.0', 'Content-Type': 'application/json' },
        body: '{}',
      },
      new Date('2026-10-22T12:00:00.000Z'),
    );
    expect(headers['X-Sdk-Date']).toBe('20261022T120000Z');
    const decoded = Buffer.from(headers.Authorization!.replace('Bearer ', ''), 'base64').toString();
    expect(decoded).toMatch(
      /^SDK-HMAC-SHA256 Access=AK123, SignedHeaders=content-type;user-agent;x-sdk-date, Signature=[0-9a-f]{64}$/,
    );
    // Mesma entrada, mesma assinatura.
    const again = signVmakeRequest(
      creds,
      {
        url: 'https://wapi-skill.vmake.ai/skill/config.json',
        method: 'POST',
        headers: { 'User-Agent': 'vmake-skill-v2.0.0', 'Content-Type': 'application/json' },
        body: '{}',
      },
      new Date('2026-10-22T12:00:00.000Z'),
    );
    expect(again.Authorization).toBe(headers.Authorization);
  });
});

describe('vmakeOutputUrls', () => {
  it('acha o link do vídeo nos formatos de resposta conhecidos', () => {
    expect(vmakeOutputUrls({ data: { result: { urls: ['https://cdn.test/a.mp4'] } } })).toEqual([
      'https://cdn.test/a.mp4',
    ]);
    expect(
      vmakeOutputUrls({
        data: { result: { media_info_list: [{ media_data: 'https://cdn.test/b.mp4' }] } },
      }),
    ).toEqual(['https://cdn.test/b.mp4']);
    expect(vmakeOutputUrls({ data: {} })).toEqual([]);
  });
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** vMake simulada: catálogo, credenciais de envio, armazenamento, cota, tarefa e status. */
function fakeVmake() {
  const calls: { method: string; url: string; body: string }[] = [];
  let polls = 0;
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method = request ? request.method : (init?.method ?? 'GET');
    const body = init?.body ? Buffer.from(init.body as Buffer).toString() : '';
    calls.push({ method, url, body });
    if (url.endsWith('/skill/config.json')) {
      return json({
        meta: { code: 0 },
        response: {
          gid: 'sk_1',
          algorithm: {
            regions: { 'cn-north-4': 'strategy.test' },
            token_policy_type: 'mtai',
            invoke: {
              SKM0002: {
                name: 'Subtitle - Remove Video Subtitles',
                task: '/v1/videosubtitle_remove_async',
                task_type: 'speedup',
                params: null,
                media_type: 'video',
                max_size: 1000,
              },
              SKM0003: {
                name: 'Smart - Video Smart Removal',
                task: '/v1/videoscreenclear_async',
                task_type: 'speedup',
                params: { parameter: { rsp_media_type: 'url' } },
                media_type: 'video',
              },
            },
          },
        },
      });
    }
    if (url.startsWith('https://strategy.test/ai/token_policy')) {
      return json({
        data: {
          mtai: {
            api: {
              order: ['oss'],
              oss: {
                url: 'https://openapi.test',
                push_path: 'api/sdk/task/run_async',
                status_query: { path: 'api/sdk/task/status' },
                sync_timeout: 15,
              },
            },
            upload: {
              order: ['oss'],
              oss: {
                bucket: 'kapkap',
                url: 'https://oss-ap-southeast-1.aliyuncs.com',
                region: 'ap-southeast-1',
                key: 'skill_upload/abc',
                data: 'https://kapkap.stariidata.test/skill_upload/abc',
                credentials: { access_key: 'STS', secret_key: 'STSSECRET', session_token: 'TOKEN' },
              },
            },
          },
        },
      });
    }
    if (url === 'https://kapkap.oss-ap-southeast-1.aliyuncs.com/skill_upload/abc') {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith('/skill/consume.json'))
      return json({ meta: { code: 0 }, response: { context: 'ctx-1' } });
    if (url === 'https://openapi.test/api/sdk/task/run_async') {
      return json({ meta: { code: 0 }, data: { status: 9, result: { id: 'task-1' } } });
    }
    if (url.startsWith('https://openapi.test/api/sdk/task/status')) {
      polls += 1;
      return json(
        polls === 1
          ? { meta: { code: 0 }, data: { status: 1 } }
          : {
              meta: { code: 0 },
              data: { status: 10, result: { urls: ['https://cdn.test/sem-legenda.mp4'] } },
            },
      );
    }
    throw new Error(`não simulado: ${method} ${url}`);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('VmakeClient.removeSubtitles', () => {
  it('envia o vídeo, registra o uso, roda a remoção de legendas e espera o resultado', async () => {
    const { fetchFn, calls } = fakeVmake();
    const client = new VmakeClient(creds, { fetch: fetchFn, sleep: async () => undefined });

    const result = await client.removeSubtitles({
      video: new Uint8Array([1, 2, 3]).buffer,
      contentType: 'video/mp4',
    });

    expect(result).toEqual({
      videoUrl: 'https://cdn.test/sem-legenda.mp4',
      taskName: 'Subtitle - Remove Video Subtitles',
    });
    const consume = calls.find((c) => c.url.endsWith('/skill/consume.json'))!;
    expect(JSON.parse(consume.body)).toEqual({
      url: 'https://kapkap.stariidata.test/skill_upload/abc',
      task: 'SKM0002',
      gid: 'sk_1',
    });
    const run = calls.find((c) => c.url.endsWith('/run_async'))!;
    expect(JSON.parse(run.body)).toMatchObject({
      task: '/v1/videosubtitle_remove_async',
      task_type: 'speedup',
      context: 'ctx-1',
      params: '{}',
      init_images: [{ url: 'https://kapkap.stariidata.test/skill_upload/abc' }],
    });
  });

  it('na remoção inteligente usa a outra tarefa, com os parâmetros do catálogo', async () => {
    const { fetchFn, calls } = fakeVmake();
    await new VmakeClient(creds, { fetch: fetchFn, sleep: async () => undefined }).removeSubtitles({
      video: new Uint8Array([1]).buffer,
      contentType: 'video/mp4',
      smart: true,
    });
    const run = calls.find((c) => c.url.endsWith('/run_async'))!;
    expect(JSON.parse(run.body)).toMatchObject({
      task: '/v1/videoscreenclear_async',
      params: '{"parameter":{"rsp_media_type":"url"}}',
    });
  });

  it('recusa vídeo acima do limite da tarefa antes de gastar cota', async () => {
    const { fetchFn, calls } = fakeVmake();
    await expect(
      new VmakeClient(creds, { fetch: fetchFn }).removeSubtitles({
        video: new Uint8Array(2000).buffer,
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow('O vídeo passa do limite da vMake');
    expect(calls.some((c) => c.url.endsWith('/skill/consume.json'))).toBe(false);
  });
});
