import { ReferenceSourceId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ReferenceSource } from './reference-source';

const create = (handle = '@SaoBento.Oficial', locale?: string) =>
  ReferenceSource.create(ReferenceSourceId('src-1'), { handle, ...(locale ? { locale } : {}) });

describe('ReferenceSource', () => {
  it('normaliza o usuário, usa pt-BR por padrão e começa conectada e nunca sincronizada', () => {
    const source = create();

    expect(source.handle).toBe('saobento.oficial');
    expect(source.locale).toBe('pt-BR');
    expect(source.connectionStatus).toBe('connected');
    expect(source.isConnected).toBe(true);
    expect(source.lastSyncedAt).toBeNull();
  });

  it('pode ser cadastrada já desconectada', () => {
    const source = ReferenceSource.create(ReferenceSourceId('src-2'), {
      handle: 'conta',
      connected: false,
    });
    expect(source.isConnected).toBe(false);
  });

  it.each([
    ['https://www.instagram.com/SantaEspiritualidade/', 'santaespiritualidade'],
    ['instagram.com/santaespiritualidade?hl=pt-br', 'santaespiritualidade'],
    ['https://m.instagram.com/santa.espiritualidade/reels/', 'santa.espiritualidade'],
    ['  @santa_espiritualidade  ', 'santa_espiritualidade'],
  ])('aceita o link do perfil ou o @: %s', (raw, handle) => {
    expect(create(raw).handle).toBe(handle);
  });

  it('canonicaliza o idioma informado', () => {
    expect(create('conta', 'pt-br').locale).toBe('pt-BR');
  });

  it.each([
    ['usuário com espaço', () => create('são bento'), 'invalid_handle'],
    ['usuário vazio', () => create('@'), 'invalid_handle'],
    ['usuário longo demais', () => create('a'.repeat(31)), 'invalid_handle'],
    ['idioma inválido', () => create('conta', '??'), 'invalid_locale'],
  ])('rejeita %s', (_label, fn, code) => {
    expect(fn).toThrow(expect.objectContaining({ code }));
  });

  it('marca a última sincronização', () => {
    const source = create();
    const at = new Date('2026-10-15T12:00:00.000Z');
    source.markSynced(at);
    expect(source.lastSyncedAt).toEqual(at);
  });

  it('desconecta e conecta de novo', () => {
    const source = create();
    source.disconnect();
    expect(source.connectionStatus).toBe('disconnected');
    source.connect();
    expect(source.connectionStatus).toBe('connected');
  });

  it('sobrevive a ida e volta pelo snapshot', () => {
    const source = create();
    source.markSynced(new Date('2026-10-15T12:00:00.000Z'));
    expect(ReferenceSource.fromSnapshot(source.toSnapshot()).toSnapshot()).toEqual(
      source.toSnapshot(),
    );
    const fresh = create();
    expect(ReferenceSource.fromSnapshot(fresh.toSnapshot()).lastSyncedAt).toBeNull();
  });
});
