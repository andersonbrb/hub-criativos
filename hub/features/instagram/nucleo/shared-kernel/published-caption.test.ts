import { describe, expect, it } from 'vitest';
import { composePublishedCaption } from './published-caption';

describe('composePublishedCaption', () => {
  it('junta legenda e hashtags com uma linha em branco e um único #', () => {
    expect(composePublishedCaption('Oración', ['sanbenito', '#fe', '##reels'])).toBe(
      'Oración\n\n#sanbenito #fe #reels',
    );
  });

  it('sem hashtags devolve só a legenda', () => {
    expect(composePublishedCaption('Oración', ['  '])).toBe('Oración');
  });
});
