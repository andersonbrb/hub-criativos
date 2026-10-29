import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { aMarketProfile } from '../../testing';
import { ClaudeCopyLocalizer, parseLocalizedCopy } from './claude-copy-localizer';

function fakeClient(reply: { text?: string; stop_reason?: string }) {
  const create = vi.fn(async () => ({
    stop_reason: reply.stop_reason ?? 'end_turn',
    content: reply.text === undefined ? [] : [{ type: 'text', text: reply.text }],
  }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const input = {
  sourceCaption: 'Oração de São Bento 🙏 #fe',
  format: 'reel' as const,
  sourceLocale: 'pt-BR',
  market: aMarketProfile({
    locale: 'es-419',
    productName: 'San Benito',
    offerUrl: 'https://sanbenito.example.com/es',
    glossary: [{ source: 'São Bento', target: 'San Benito' }],
    forbiddenTerms: ['Sagrado Verso'],
  }),
  suggestion: 'Mais curta',
};

describe('ClaudeCopyLocalizer', () => {
  it('manda o mercado, o glossário, os termos proibidos e a sugestão, e lê a resposta', async () => {
    const { client, create } = fakeClient({
      text: JSON.stringify({
        caption: 'Oración de San Benito 🙏\n\n👉 San Benito: https://sanbenito.example.com/es',
        hashtags: ['sanbenito', '#oracion', '#oracion', 'fe católica'],
      }),
    });

    const result = await new ClaudeCopyLocalizer(client).localize(input);

    expect(result).toEqual({
      caption: 'Oración de San Benito 🙏\n\n👉 San Benito: https://sanbenito.example.com/es',
      hashtags: ['#sanbenito', '#oracion', '#fecatólica'],
    });
    const [request] = create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    const prompt = JSON.stringify(request['messages']);
    for (const part of [
      'es-419',
      '\\"São Bento\\" → \\"San Benito\\"',
      'Sagrado Verso',
      'Mais curta',
    ]) {
      expect(prompt).toContain(part);
    }
  });

  it('recusa e respostas inválidas viram erro (a produção marca falha)', async () => {
    await expect(
      new ClaudeCopyLocalizer(fakeClient({ stop_reason: 'refusal' }).client).localize(input),
    ).rejects.toThrow('recusou');
    await expect(
      new ClaudeCopyLocalizer(fakeClient({ text: 'não é json' }).client).localize(input),
    ).rejects.toThrow('JSON');
  });
});

describe('parseLocalizedCopy', () => {
  it('exige legenda', () => {
    expect(() => parseLocalizedCopy('{"caption":"  ","hashtags":[]}')).toThrow('sem legenda');
  });
});
