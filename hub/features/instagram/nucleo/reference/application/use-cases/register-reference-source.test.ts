import { SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryReferenceSourceRepository } from '../../infrastructure';
import { ListReferenceSources } from './list-reference-sources';
import { RegisterReferenceSource } from './register-reference-source';

describe('RegisterReferenceSource / ListReferenceSources', () => {
  let sources: InMemoryReferenceSourceRepository;
  let register: RegisterReferenceSource;

  beforeEach(() => {
    sources = new InMemoryReferenceSourceRepository();
    register = new RegisterReferenceSource(sources, new SequentialIdGenerator('src'));
  });

  it('cadastra a conta de referência e a salva', async () => {
    const source = await register.execute({ handle: '@SaoBento.Oficial', locale: 'pt-BR' });

    expect(source.id).toBe('src-1');
    expect((await sources.findById(source.id))?.handle).toBe('saobento.oficial');
  });

  it('não aceita a mesma conta duas vezes, sem diferenciar @ e maiúsculas', async () => {
    await register.execute({ handle: 'saobento.oficial', locale: 'pt-BR' });
    await expect(register.execute({ handle: '@SAOBENTO.oficial' })).rejects.toMatchObject({
      code: 'source_handle_taken',
    });
  });

  it('rejeita usuário inválido antes de consultar o repositório', async () => {
    await expect(register.execute({ handle: 'são bento' })).rejects.toMatchObject({
      code: 'invalid_handle',
    });
  });

  it('lista as contas cadastradas por usuário', async () => {
    await register.execute({ handle: 'zelo_catolico' });
    await register.execute({ handle: 'aves_marias' });

    const list = await new ListReferenceSources(sources).execute();
    expect(list.map((s) => s.handle)).toEqual(['aves_marias', 'zelo_catolico']);
  });
});
