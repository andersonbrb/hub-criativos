import "server-only";

import type { StatusDrive } from "@/features/drive/contrato";

// Conta Google do Drive (login OAuth na tela Integrações). Contrato estável: as assinaturas não mudam.
// Implementação: agente Conta do Drive.

export class DriveNaoConectado extends Error {
  constructor() {
    super("O Google Drive não está conectado. Um admin precisa conectar em Integrações → Google Drive.");
  }
}

export async function statusDrive(): Promise<StatusDrive> {
  throw new Error("Em construção: statusDrive.");
}

// Endereço do Google para a pessoa autorizar. `volta`: caminho do hub para onde ela volta depois.
export async function iniciarLogin(volta: string, origem: string): Promise<string> {
  void volta, origem;
  throw new Error("Em construção: iniciarLogin.");
}

// Recebe o retorno do Google; devolve o caminho para onde mandar a pessoa.
export async function concluirLogin(code: string, state: string, origem: string): Promise<string> {
  void code, state, origem;
  throw new Error("Em construção: concluirLogin.");
}

export async function desconectar(): Promise<void> {
  throw new Error("Em construção: desconectar.");
}

// Token de acesso válido (renova sozinho). Lança DriveNaoConectado.
export async function tokenDeAcesso(): Promise<string> {
  throw new Error("Em construção: tokenDeAcesso.");
}
