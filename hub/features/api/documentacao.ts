import { ROTA_CONFERIR_CHAVE, ROTA_GERAR_GANCHOS } from "@/features/api/contrato";
import {
  DOMINIOS_DA_MIDIA,
  MAXIMO_DE_ANUNCIOS,
  MAXIMO_DE_CRIATIVOS,
  MAXIMO_DE_METRICAS,
  TETO_DA_IMAGEM,
  TETO_DO_CORPO,
  TETO_DO_VIDEO,
  VALIDADE_DO_LINK_MS,
} from "@/features/skala/contrato";

// Texto da tela "Documentação da API" (Markdown). Os limites saem do contrato, para a documentação nunca ficar
// diferente do que o hub aceita. `base`: o endereço público do hub (HUB_PUBLIC_URL).
// Chamada nova na API: acrescente aqui uma seção com o endereço, o que manda, o que volta e um exemplo.

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export function documentacaoDaApi(base: string): string {
  const horas = VALIDADE_DO_LINK_MS / 3_600_000;
  return `# API do Hub de Criativos

A API deixa outro sistema (o Skala Ads, por exemplo) mandar trabalho para o Hub de Criativos sem ninguém precisar copiar e colar. Hoje dá para:

- **Gerar ganchos a partir de um criativo:** o sistema manda o vídeo (ou a imagem), a capa, o produto, os países e os números do criativo e recebe o link do chat principal do hub, que já abre com o criativo e começa a escrever os ganchos.
- **Conferir a chave:** saber se a chave colada está certa, sem mandar nada.

## Como entrar com a chave

1. Um dono ou admin do hub cria uma chave em **API → Chaves de API**, com um nome que diga onde ela vai ser usada (ex.: "Skala — produção").
2. A chave inteira aparece **uma vez só**, na hora de criar. Copie e guarde no outro sistema, num lugar secreto do servidor dele.
3. Toda chamada leva a chave no cabeçalho:

\`\`\`
Authorization: Bearer hub_api_...
\`\`\`

- **A chave é da organização em que foi criada.** O que ela manda entra no chat dessa organização.
- **Chame a API sempre do servidor do outro sistema, nunca do navegador.** Chave que aparece no navegador deixa de ser segredo.
- **Revogar vale na hora.** A próxima chamada com aquela chave é recusada. A lista mostra quando cada chave foi usada pela última vez.

Endereço do hub: \`${base}\`

## Gerar ganchos a partir de um criativo

\`POST ${base}${ROTA_GERAR_GANCHOS}\`

Manda de 1 a ${MAXIMO_DE_CRIATIVOS} criativos. O hub guarda e devolve um link de uso único para o chat principal. Quem abrir o link (logado no hub) cai numa conversa nova chamada "Ganchos: <nome do criativo>". A primeira mensagem vai sozinha, com o vídeo, a "Ficha" do criativo e o pedido, e o agente começa os ganchos na hora.

### O que mandar (JSON)

| Campo | Obrigatório | O que é |
| --- | --- | --- |
| \`criativos\` | sim | lista de 1 a ${MAXIMO_DE_CRIATIVOS} criativos (campos abaixo) |
| \`pedido\` | não | o texto da primeira mensagem. Sem ele: "Me dê ganchos baseados neste criativo." |
| \`id\` | sim | o id do criativo no seu sistema |
| \`nome\` | não | o nome que aparece no chat |
| \`plataforma\` | não | "TikTok", "Meta"… |
| \`produto\` | não | o produto anunciado |
| \`paises\` | não | lista de países (ex.: \`["CL", "MX"]\`) |
| \`periodo\` | não | o período dos números, em texto |
| \`link\` | não | o endereço do criativo no seu sistema |
| \`video_url\` | não | o vídeo (mp4) |
| \`capa_url\` | não | a capa (jpg ou png). Entra no lugar do vídeo quando ele não vem |
| \`imagem_url\` | não | a imagem de um anúncio estático |
| \`texto\`, \`titulo\`, \`chamada\` | não | o texto do anúncio, o título e a chamada (CTA) |
| \`metricas\` | não | os números, como \`{ "rótulo": valor }\`, até ${MAXIMO_DE_METRICAS}, na ordem em que devem aparecer |
| \`anuncios\` | não | os anúncios que usam o criativo, como lista de \`{ "coluna": valor }\`, até ${MAXIMO_DE_ANUNCIOS} |

- **Vídeo e imagem:** só https, e só destes domínios (e dos subdomínios deles): ${DOMINIOS_DA_MIDIA.map((d) => `\`${d}\``).join(", ")}, além dos servidores de vídeo do TikTok na Akamai. Vídeo até ${mb(TETO_DO_VIDEO)}, imagem até ${mb(TETO_DA_IMAGEM)}.
- **Quando o hub baixa:** quando a pessoa abre o link, não na hora da chamada. Mande o link mais novo do vídeo. Se ele não vier (vencido, grande demais, tipo errado), a conversa começa com a capa e um aviso.
- **Tamanho:** o corpo inteiro tem até ${TETO_DO_CORPO / 1024} KB. Campo desconhecido é ignorado, e texto longo é cortado.

### Exemplo

\`\`\`bash
curl -X POST "${base}${ROTA_GERAR_GANCHOS}" \\
  -H "Authorization: Bearer $HUB_CRIATIVOS_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "pedido": "Me dê ganchos baseados neste criativo.",
    "criativos": [{
      "id": "7431234567890123456",
      "nome": "CAMERA WIFI - AD07 casa sozinha",
      "plataforma": "TikTok",
      "produto": "Câmera Wi-Fi",
      "paises": ["CL"],
      "periodo": "20/10/2026 a 26/10/2026",
      "video_url": "https://v16m.tiktokcdn.com/.../video.mp4",
      "capa_url": "https://p16-sign.tiktokcdn.com/.../capa.jpeg",
      "metricas": { "Gasto (US$)": 1234.56, "Vendas": 87, "CPA (US$)": 14.19 },
      "anuncios": [{ "campanha": "CL | CAMERA | ABO 03", "conta": "TT Chile 2", "pais": "CL", "gasto": 802.1, "vendas": 61 }]
    }]
  }'
\`\`\`

### O que volta

\`201\`: o link para abrir numa aba nova.

\`\`\`json
{
  "url": "${base}/chat?skala=hub_sk_...",
  "expira_em": "2026-10-28T18:00:00.000Z",
  "criativos": 1
}
\`\`\`

- **O link é de uso único e vale ${horas} horas.** Quem abriu e reabre volta à mesma conversa. Outra pessoa, ou link vencido, vê um aviso para gerar de novo.
- **Sem login no hub:** a pessoa entra e volta direto para a conversa.
- **Quem pode abrir:** é preciso participar da organização da chave, com a tela Chat liberada.
- **Dica para não ter a aba bloqueada:** abra a aba antes da chamada (\`window.open("about:blank")\`) e troque o endereço dela quando a resposta chegar.

## Conferir a chave

\`GET ${base}${ROTA_CONFERIR_CHAVE}\`

Não manda nada e não muda nada. Serve para a tela de integrações do outro sistema testar a chave colada.

\`\`\`bash
curl "${base}${ROTA_CONFERIR_CHAVE}" -H "Authorization: Bearer $HUB_CRIATIVOS_CHAVE"
\`\`\`

\`200\`:

\`\`\`json
{ "ok": true, "organizacao": "Grupo Chegou", "chave": "Skala — produção" }
\`\`\`

## Erros

Todo erro volta como \`{ "error": "motivo em português" }\`.

| Código | Quando |
| --- | --- |
| \`400\` | dado errado (o motivo diz qual campo, ex.: \`criativos[0]: falta o "id"\`) |
| \`401\` | sem chave, chave errada ou revogada |
| \`413\` | corpo maior que ${TETO_DO_CORPO / 1024} KB |
| \`503\` | a API está desligada neste hub (só acontece na cópia do hub que roda sem banco, num computador) |

Use um tempo máximo de espera de uns 15 segundos: as chamadas só gravam e respondem.
`;
}
