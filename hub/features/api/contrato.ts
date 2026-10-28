// Contrato da API do hub: as chaves de API (tela "Chaves de API") e a documentação (tela "Documentação da API").
// Arquivo puro (sem código de servidor): a tela importa. Serviços em features/api/servicos.
//
// Quem chama a API é o SERVIDOR de outro sistema (o Skala, e depois o Funila), nunca um navegador: a chave vai no
// cabeçalho "Authorization: Bearer <chave>". Cada chave é de uma organização: o que ela manda entra nessa organização.
// Só o dono ou um admin da organização cria e revoga chaves. A chave inteira aparece uma vez, na hora de criar; no
// banco fica só o SHA-256 dela, como os tokens do conector.
//
// A chave fixa do Skala (variável HUB_CHAVE_DO_SKALA do servidor, features/skala) continua valendo do mesmo jeito,
// para a Grupo Chegou, até ser tirada do Railway.

export const PREFIXO_DA_CHAVE = "hub_api_";
// Começo da chave mostrado na lista (o prefixo e mais 4 letras), para reconhecer qual é qual.
export const TAMANHO_DO_COMECO = PREFIXO_DA_CHAVE.length + 4;
export const NOME_MINIMO = 3;
export const NOME_MAXIMO = 80;

// Endereços da API (o mesmo caminho que o Skala já usa para "Gerar ganchos").
export const ROTA_GERAR_GANCHOS = "/api/skala/criativos";
export const ROTA_CONFERIR_CHAVE = "/api/chave-de-api";

export type ChaveNaTela = {
  id: string;
  nome: string;
  comeco: string;
  criadaEm: string;
  criadaPor: string | null;
  ultimoUsoEm: string | null;
  revogadaEm: string | null;
};
