# Skala → Hub de Criativos: botão "Gerar ganchos"

Receita da conexão para quem mexe no Skala (repositório `Grupo-Chegou-2-0/skalaads`). O lado do hub já está pronto.

## O que acontece

Na aba **Criativos** do TikTok Ads do Skala, a pessoa clica em **Selecionar**, escolhe o criativo e clica em **Gerar
ganchos**. Abre uma aba nova no chat principal do hub, numa conversa nova chamada "Ganchos: <nome do criativo>". A
primeira mensagem vai sozinha, com o pedido ("Me dê ganchos baseados neste criativo."), o vídeo do criativo e a "Ficha
do Skala" (produto, países, período, números e anúncios). O agente começa a responder na hora, e a pessoa continua a
conversa dali.

```
navegador (Skala) ──clique──▶ servidor do Skala ──POST com a chave──▶ hub: guarda e devolve { url }
        ▲                                                                       │
        └──────────── abre a url numa aba nova ◀─────── servidor do Skala ◀─────┘
hub (/chat?skala=…): pede login se precisar → manda a 1ª mensagem → baixa o vídeo do CDN do TikTok → ganchos
```

## 1. O endereço

- Hub de produção: `https://hubdecriativos.up.railway.app`
- O servidor do Skala chama: `POST https://hubdecriativos.up.railway.app/api/skala/criativos`
- O botão abre a `url` que essa chamada devolve (`https://hubdecriativos.up.railway.app/chat?skala=hub_sk_…`).

A chamada sai **do servidor do Skala**, nunca do navegador: a chave não pode ir para o frontend.

## 2. A chave

- O hub guarda a chave na variável **`HUB_CHAVE_DO_SKALA`** do serviço **Hub Produção**, no projeto **Hub de
  Criativos** do Railway (área "Grupo Chegou", ambiente `production`). Ids: projeto
  `decc4e81-4032-4894-b887-d8d3bffd7e07`, ambiente `a90be87a-0084-493d-9fbf-74ffd2b6c874`, serviço
  `226eecf3-4db4-4aae-afc2-77d3123ecd08`.
- O Skala guarda o **mesmo valor** numa variável do serviço do backend dele (sugestão: `HUB_CRIATIVOS_CHAVE`), com o
  endereço em `HUB_CRIATIVOS_URL=https://hubdecriativos.up.railway.app`. Leia com `os.getenv`, como o resto do
  `settings.py`.
- Copie de variável para variável pelo login do Railway deste PC (MCP do Railway ou API com o login da linha de
  comando), sem mostrar o valor em conversa, log, commit ou arquivo. Nunca no código nem no GitHub.
- Vai no cabeçalho: `Authorization: Bearer <chave>`. Chave errada: 401. Variável vazia no hub: 503 (conexão
  desligada).
- Para trocar a chave: gere um valor novo (32 bytes aleatórios), grave nas duas variáveis e publique os dois serviços.

## 3. O que mandar (JSON)

```json
{
  "pedido": "Me dê ganchos baseados neste criativo.",
  "criativos": [
    {
      "id": "7431234567890123456",
      "nome": "CAMERA WIFI - AD07 casa sozinha",
      "plataforma": "TikTok",
      "produto": "Câmera Wi-Fi",
      "paises": ["CL"],
      "periodo": "20/10/2026 a 26/10/2026",
      "link": "https://app.skalaads.com.br/tiktok?tab=criativos",
      "video_url": "https://v16m.tiktokcdn.com/…/video.mp4?…",
      "capa_url": "https://p16-sign.tiktokcdn.com/…/capa.jpeg",
      "metricas": { "Gasto (US$)": 1234.56, "Vendas": 87, "CPA (US$)": 14.19, "Impressões": 412300, "CTR (%)": 1.48 },
      "anuncios": [
        { "campanha": "CL | CAMERA | ABO 03", "conta": "TT Chile 2", "pais": "CL", "gasto": 802.1, "vendas": 61 }
      ]
    }
  ]
}
```

| Campo | Obrigatório | O que é | De onde sai no Skala (TikTok) |
|---|---|---|---|
| `criativos` | sim | lista de 1 a 5 criativos | os escolhidos na seleção |
| `pedido` | não | o texto da 1ª mensagem (até 2000 caracteres). Sem ele: "Me dê ganchos baseados neste criativo." (ou "nestes criativos") | — |
| `id` | sim | id do criativo no Skala | `video_id` |
| `nome` | não | nome que aparece no chat | `nome_criativo()` / o `nome` do card |
| `plataforma` | não | "TikTok", "Meta"… | fixo "TikTok" nesta aba |
| `produto` | não | produto | o produto do card (vem do nome da campanha) |
| `paises` | não | lista de textos (ou texto separado por vírgula) | `pais` dos anúncios do grupo, sem repetir |
| `periodo` | não | período dos números, em texto | o filtro de datas da tela |
| `link` | não | link do criativo no Skala | a aba Criativos |
| `video_url` | não | vídeo (mp4) | `VideoTiktok.video_url`, **só no servidor**. Se `expira_em` já passou, não mande |
| `capa_url` | não | capa (jpg) | `VideoTiktok.capa_url` |
| `imagem_url` | não | imagem de anúncio estático | (Meta: `imagem_url`) |
| `texto`, `titulo`, `chamada` | não | copy do anúncio, título e CTA | (Meta: `texto`, `titulo`, `chamada`; o TikTok não guarda) |
| `metricas` | não | objeto `{ "rótulo": valor }`, até 40, na ordem em que devem aparecer | os números do card no período: gasto, vendas (conversões), CPA, impressões, cliques, CTR, CPC, CPM |
| `anuncios` | não | lista de objetos `{ "coluna": valor }`, até 30 linhas e 15 colunas | `g.ads`: campanha, conta, país, gasto, vendas |

- Valor de `metricas` e `anuncios`: texto, número, `true`/`false` ou `null`. Mande o rótulo como a pessoa lê na tela
  (com a moeda, se ajudar).
- Campo desconhecido é ignorado. Texto longo é cortado. Corpo inteiro: até 256 KB.
- **De onde o hub baixa:** só `https` (o `http` vira `https`), só destes domínios e dos subdomínios deles:
  `skalaads.com.br`, `tiktokcdn.com`, `tiktokcdn-us.com`, `tiktokcdn-eu.com`, `ibyteimg.com`, `byteimg.com`,
  `fbcdn.net`, `res.cloudinary.com`, mais os servidores de vídeo do TikTok na Akamai (`v16m-default.akamaized.net` e
  parecidos). Outro domínio é recusado com 400, dizendo qual veio. Até 3 redirecionamentos, todos dentro da lista.
- **Tamanho e tipo:** vídeo até 300 MB, imagem até 25 MB. O tipo é conferido pelos primeiros bytes (mp4, mov, webm,
  jpg, png, webp, gif).
- O hub baixa a mídia quando a pessoa abre o link, não na chamada. O link do CDN do TikTok vence em horas, e o do hub
  em 2 horas, então mande a `video_url` mais nova que tiver.

### Resposta

- `201`: `{ "url": "https://hubdecriativos.up.railway.app/chat?skala=hub_sk_…", "expira_em": "2026-10-27T05:25:03.104Z", "criativos": 1 }`
- `400`: `{ "error": "…" }`, com o motivo em português (ex.: `criativos[0]: falta o "id" do criativo no Skala.`)
- `401`: chave errada. `413`: corpo grande demais. `503`: a conexão está desligada no hub.

Use um timeout de uns 15 segundos (a chamada só grava no banco e responde).

## 4. O botão no Skala

- Lugar natural: a barra que aparece com **Selecionar** na aba Criativos (`CriativosTab.jsx`), ao lado de **Baixar
  selecionados**. Habilitado com 1 a 5 criativos escolhidos.
- No clique, abra a aba **antes** de chamar o servidor, senão o navegador bloqueia a janela:
  `const aba = window.open("about:blank", "_blank")`. Depois chame um endpoint novo do backend do Skala (por exemplo
  `POST /api/ads/tiktok/criativos/gerar-ganchos/` com os `video_id` escolhidos e o período da tela, com a sessão e o
  `X-Operacao` de sempre). Com a `url` de volta: `aba.location.href = url`. Com erro: `aba.close()` e a mensagem na
  tela.
- O endpoint do Skala monta o JSON acima **só com dados da operação do pedido** (`operacao_do_request`), lê
  `video_url` e `expira_em` do `VideoTiktok`, chama o hub com `requests.post(..., timeout=15)` e devolve só a `url`.
  Erros do hub passam por `sanitize_text` antes de ir para a tela.

## 5. Login e quem pode abrir

- Sem login no hub: a pessoa cai na tela de entrar e, depois de entrar, volta direto para o chat com o criativo.
  Nada se perde.
- A conta precisa estar na **Grupo Chegou** no hub, com a tela **Chat** liberada. Se a pessoa estiver com outra
  organização aberta no hub, ele troca sozinho para a Grupo Chegou. Quem não participa vê um aviso.
- O link é de **uso único** e vale **2 horas**. Reabrir o mesmo link leva a quem abriu para a mesma conversa. Outra
  pessoa vê um aviso para clicar de novo no Skala. Link vencido também mostra um aviso.
- O link sozinho não faz nada: só começa conversa para quem está logado no hub. A IA só roda depois disso.

## 6. O que o hub faz com o vídeo

- O vídeo vai para o Google Drive da Grupo Chegou (pasta "Enviados pela equipe"), como todo vídeo do hub. O agente
  assiste por lá.
- Se o vídeo não vier (link vencido, grande demais, tipo errado, Drive desconectado), a conversa começa mesmo assim,
  com a capa no lugar do vídeo. Um aviso aparece na própria mensagem, para a pessoa e para o agente.

## 7. Como testar

1. **Sem a chave:** precisa dar `401`.

   ```bash
   curl -s -X POST https://hubdecriativos.up.railway.app/api/skala/criativos -H "content-type: application/json" -d '{"criativos":[{"id":"1"}]}'
   ```

2. **Com a chave**, lida da variável, sem digitar o valor. No Skala, um teste de Django com `requests` simulado confere
   que o JSON sai como acima, só com dados da operação, e que a chave vai no cabeçalho.
3. **De verdade:** clique em **Gerar ganchos** num criativo com vídeo válido. Precisa abrir o hub, pedir login (se
   preciso), mostrar "Trazendo do Skala…", a mensagem com o vídeo e a ficha, e os ganchos saindo.

   Cada teste de verdade cria uma conversa no hub e gasta a IA do chat.
