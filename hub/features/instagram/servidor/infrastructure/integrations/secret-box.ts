import { cifrar, decifrar } from '@/features/integracoes/servicos/cifra';

/**
 * Cifra os tokens das contas do Instagram antes de gravar no banco, com a mesma chave e o mesmo formato das outras
 * chaves do hub (HUB_CHAVE_SEGREDOS, features/integracoes/servicos/cifra.ts). Trocar a chave exige conectar as contas
 * de novo.
 */
export class SecretBox {
  seal(plain: string): string {
    return cifrar(plain);
  }

  open(sealed: string): string {
    return decifrar(sealed);
  }
}
