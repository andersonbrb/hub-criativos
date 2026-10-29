// Contrato do servidor de edições: as edições de vídeo (edição final, edição na batida, remover legenda, exportação do
// editor) e a transcrição pelo Whisper rodam num serviço à parte no Railway, para o site não ficar lento enquanto
// alguém edita (pedido do dono, 28/10/2026: "vale separar sim"). Arquivo puro: o site e o servidor de edições importam.
//
// Quem faz o quê:
//   - o SITE continua dono de tudo que é do hub: gerações, organizações, Google Drive, registro da edição. Ele baixa as
//     entradas (do Drive ou da mídia), manda para o servidor de edições, acompanha o registro e baixa o vídeo pronto,
//     que segue para o Drive como sempre (concluirComArquivo);
//   - o SERVIDOR DE EDIÇÕES só calcula: recebe os arquivos, roda Python, ffmpeg e Remotion e devolve o resultado. Não
//     tem banco, nem Drive, nem chave de nenhuma integração. Pode dormir quando não há edição (Serverless do Railway).
//
// O caminho de uma edição (features/edicoes/servicos/rodar.ts no site, servicos/servidor.ts do outro lado):
//   1. PUT  /trabalhos/<id>/entradas/<nome>  cada arquivo de entrada (o corpo é o arquivo);
//   2. POST /trabalhos/<id>                  o trabalho (JSON): começa ou, se já existe, só devolve a situação;
//   3. GET  /trabalhos/<id>?desde=<n>        situação e o registro a partir do caractere n (a tela mostra o progresso);
//   4. GET  /trabalhos/<id>/saida            o vídeo pronto;
//   5. DELETE /trabalhos/<id>                apaga a pasta do trabalho no servidor de edições.
// Tudo com "Authorization: Bearer <HUB_CHAVE_DAS_EDICOES>", pela rede privada do Railway. Só /api/saude é aberta.
//
// Sem o endereço (HUB_SERVIDOR_DE_EDICOES), o site roda as edições nele mesmo, como antes (o PC do dono, por exemplo).

// Variáveis do Railway. As duas pontas leem a mesma chave combinada (como a do Skala, é uma senha entre dois
// sistemas, não a chave de um serviço que alguém cola na tela).
export const VARIAVEL_DO_ENDERECO = "HUB_SERVIDOR_DE_EDICOES";
export const VARIAVEL_DA_CHAVE = "HUB_CHAVE_DAS_EDICOES";
// No serviço novo, HUB_SERVIDOR=edicoes faz a mesma imagem (Dockerfile) subir o servidor de edições em vez do site.
export const VARIAVEL_DO_PAPEL = "HUB_SERVIDOR";
export const TAMANHO_MINIMO_DA_CHAVE = 32;

// "instagram-reel": os textos do reel adaptado do Instagram (remotion/ReelInstagram.tsx) sobre o vídeo traduzido.
export const TIPOS_DE_TRABALHO = ["montagem", "batida", "sem-legenda", "editor", "transcricao", "instagram-reel"] as const;
export type TipoDeTrabalho = (typeof TIPOS_DE_TRABALHO)[number];

// `dados` leva os caminhos como marcadores, trocados pelo caminho de verdade em quem roda (site ou servidor de edições):
//   "@entrada/<nome>"  um arquivo de entrada (o mesmo nome de `entradas`);
//   "@saida"           o vídeo pronto;
//   "@pasta/<nome>"    arquivo ou pasta de trabalho (registro do Python, camada do Remotion, linha do tempo).
export type Trabalho = { tipo: TipoDeTrabalho; dados: Record<string, unknown>; entradas: string[] };

export const MARCA_DA_ENTRADA = "@entrada/";
export const MARCA_DA_SAIDA = "@saida";
export const MARCA_DA_PASTA = "@pasta/";

export const entrada = (nome: string) => `${MARCA_DA_ENTRADA}${nome}`;
export const pasta = (nome: string) => `${MARCA_DA_PASTA}${nome}`;

// Nome de arquivo de entrada e de pasta: sem barra e sem "..", vira nome de arquivo no disco de quem roda.
export const NOME_VALIDO = /^[\w][\w.-]{0,99}$/;
// Id do trabalho: o id da geração (uuid) ou um id próprio da transcrição.
export const ID_VALIDO = /^[\w-]{1,80}$/;

export type Situacao = "na-fila" | "rodando" | "pronto" | "falhou" | "desconhecido";

export type SituacaoDoTrabalho = {
  situacao: Situacao;
  // Registro a partir de `desde` e onde ele termina (para o próximo pedido).
  log: string;
  fimDoLog: number;
  // Falhou: a frase para a pessoa (sem o rótulo da edição, que o site põe).
  erro?: string;
  // Transcrição: a saída do Whisper (JSON em texto, como o script devolve).
  resultado?: string;
  // Pronto com vídeo: o tamanho, conferido depois do download.
  bytesDaSaida?: number;
};

// Corpo do POST do trabalho: teto para não aceitar qualquer coisa (o projeto do editor e as palavras da fala cabem).
export const TETO_DO_TRABALHO = 8 * 1024 * 1024;
