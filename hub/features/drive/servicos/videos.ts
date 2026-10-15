import "server-only";

import type { Generation } from "@/lib/generations";

// Ponte entre as gerações do hub e o Drive. Contrato estável: as assinaturas não mudam.
// Implementação: agente Vídeos no Drive.

// Leva o vídeo pronto de uma geração para o Drive e apaga a cópia local. Sem Drive conectado, deixa local e
// marca para levar depois (não perde o vídeo).
export async function guardarNoDrive(gen: Generation): Promise<Generation> {
  void gen;
  throw new Error("Em construção: guardarNoDrive.");
}

// Caminho local de um arquivo de mídia pelo nome (o `file` da geração): se está só no Drive, baixa uma cópia
// temporária. Todo código que lê mídia do disco (ffmpeg, Python, sharp, envio ao HeyGen/FLORA) passa por aqui.
export async function arquivoLocal(file: string): Promise<string> {
  void file;
  throw new Error("Em construção: arquivoLocal.");
}

// Espelho: confere no Drive as gerações que estão lá (apagadas, na lixeira, renomeadas) e atualiza o hub.
// Leve e com intervalo mínimo: pode ser chamada a cada abertura de lista.
export async function sincronizarComDrive(): Promise<void> {
  throw new Error("Em construção: sincronizarComDrive.");
}
