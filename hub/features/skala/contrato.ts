// Contrato da conexão com o Skala (o painel de anúncios do grupo): o botão "Gerar ganchos" da aba Criativos do Skala
// manda um ou mais criativos para o chat principal do hub, que já começa a conversa pedindo ganchos baseados neles.
// Arquivo puro (sem código de servidor): a tela importa. Serviços em features/skala/servicos.
//
// O caminho, de ponta a ponta (receita completa para o lado do Skala em docs/skala.md):
//   1. o SERVIDOR do Skala manda os criativos com uma chave: POST /api/skala/criativos,
//      "Authorization: Bearer <chave>". Vale uma chave de API da tela "Chaves de API" (features/api) ou a chave fixa
//      da variável do servidor. Navegador nenhum vê a chave;
//   2. o hub confere, guarda e responde com um link de uso único (/chat?skala=<token>, 2 horas);
//   3. o Skala abre o link numa aba nova. Sem login, o hub pede para entrar e volta para o link;
//   4. a tela do chat manda a primeira mensagem sozinha: o hub baixa o vídeo (ou a imagem) do CDN, que vai para o
//      Google Drive como todo vídeo, e o agente começa os ganchos. Reabrir o link leva à mesma conversa.

import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";

// A variável do serviço no Railway com a chave fixa combinada com o Skala (as duas pontas leem de lá), de antes das
// chaves de API. Sem ela, só as chaves de API valem.
export const VARIAVEL_DA_CHAVE = "HUB_CHAVE_DO_SKALA";

// A chave fixa é da Grupo Chegou: o que ela manda entra na conversa dela. Com uma chave de API, entra na organização
// da chave. Se a pessoa estiver com outra organização aberta, a tela troca (se ela participa da organização certa).
export const ORGANIZACAO_DO_SKALA = ORGANIZACAO_PADRAO.id;

export const VALIDADE_DO_LINK_MS = 2 * 60 * 60_000;
export const PREFIXO_DO_LINK = "hub_sk_";
export const PEDIDO_PADRAO = "Me dê ganchos baseados neste criativo.";
export const PEDIDO_PADRAO_VARIOS = "Me dê ganchos baseados nestes criativos.";

// Limites do que chega (o corpo inteiro tem teto de 256 KB). Texto maior é cortado, não recusado.
export const TETO_DO_CORPO = 256 * 1024;
export const MAXIMO_DE_CRIATIVOS = 5;
export const MAXIMO_DE_METRICAS = 40;
export const MAXIMO_DE_ANUNCIOS = 30;
export const MAXIMO_DE_CAMPOS_POR_ANUNCIO = 15;
export const TAMANHO_DO_TEXTO = 5000;
export const TAMANHO_DO_CAMPO = 300;
export const TAMANHO_DO_PEDIDO = 2000;

// Arquivos baixados do CDN: vídeo até 300 MB (o mesmo teto do Skala), imagem até 25 MB.
export const TETO_DO_VIDEO = 300 * 1024 * 1024;
export const TETO_DA_IMAGEM = 25 * 1024 * 1024;

// De onde o hub aceita baixar: só o próprio Skala e os serviços em que ficam os criativos dele (CDN do TikTok e da
// Meta, Cloudinary). Vale também para cada redirecionamento. Domínio aceito inclui os subdomínios.
export const DOMINIOS_DA_MIDIA = [
  "skalaads.com.br",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "ibyteimg.com",
  "byteimg.com",
  "fbcdn.net",
  "res.cloudinary.com",
];
// O TikTok também entrega o vídeo dos anúncios por servidores dele na Akamai (ex.: v16m-default.akamaized.net).
// Só esses nomes, não qualquer cliente da Akamai.
export const MIDIA_DO_TIKTOK_NA_AKAMAI = /^v\d+[a-z0-9-]*\.akamaized\.net$/;

export function dominioDaMidiaAceito(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return DOMINIOS_DA_MIDIA.some((d) => h === d || h.endsWith(`.${d}`)) || MIDIA_DO_TIKTOK_NA_AKAMAI.test(h);
}

export type Valor = string | number | boolean | null;

// Um criativo como o hub guarda (já conferido e cortado nos limites). Só `id` é obrigatório.
export type CriativoDoSkala = {
  id: string;
  nome: string;
  plataforma?: string;
  produto?: string;
  paises?: string[];
  periodo?: string;
  link?: string;
  // Copy do anúncio, quando a plataforma tem (Meta: texto, título, chamada).
  texto?: string;
  titulo?: string;
  chamada?: string;
  // Mídia: vídeo, ou imagem (estático), e a capa. Endereços do CDN, baixados quando a conversa começa.
  videoUrl?: string;
  imagemUrl?: string;
  capaUrl?: string;
  // Números do criativo no período, com o rótulo que o Skala mostra ("Gasto", "Vendas", "CPA"…).
  metricas?: Record<string, Valor>;
  // Os anúncios que usam o criativo (campanha, conta, país, gasto, vendas…).
  anuncios?: Record<string, Valor>[];
};

export type EntregaDoSkala = { criativos: CriativoDoSkala[]; pedido: string };
