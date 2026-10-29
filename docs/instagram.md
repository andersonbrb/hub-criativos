# Instagram (o antigo "San Benito Social")

Pedido do dono (29/10/2026): o projeto do Instagram (repositório `Grupo-Chegou-2-0/instagram`, painel
`agenteinsta.up.railway.app`, versão 0.3.1) veio inteiro para o hub, com item próprio no menu, e o projeto "Agente
Instagram" do Railway foi apagado depois de tudo no ar. O que ele faz: pega os posts que mais deram resultado na conta
brasileira de referência (`@santaespiritualidade`), adapta para cada mercado (San Benito em espanhol, Saint Benoît em
francês), passa pela revisão automática e pela aprovação do social media e publica no Instagram de cada país, na grade
de horários do país.

## Onde fica

- Menu → **Instagram** (`/instagram`), com as abas Início, Produção (a antiga "Pipeline"), Calendário, Referências,
  Mercados e Configurações. A revisão de uma peça fica em `/instagram/conteudos/<id>`.
- Quem entra: dono e admin da organização, e quem tiver a tela **Instagram** liberada em Equipe (chave `instagram`,
  restrita: fora do "marcar tudo", porque publica nas contas). Dono e admin fazem o que era do "administrador" do painel
  antigo (mercados, contas, publicação real, manutenção); os outros são o "social media" (revisar, aprovar, reprovar,
  editar legenda, reagendar).
- Cada organização tem os próprios mercados, contas, posts, peças e publicações. Os dados migrados estão na Grupo
  Chegou.
- Precisa do banco: no PC sem banco a seção mostra o aviso e fica fora do menu.

## Como está montado

| Parte | Onde | O que é |
| --- | --- | --- |
| Núcleo | `hub/features/instagram/nucleo/` | As regras de negócio do projeto de origem, como estavam (DDD, código em inglês, testes ao lado): `shared-kernel`, `contracts`, `markets`, `reference`, `studio`, `governance`, `publishing`. Importadas como `@sbs/<parte>` (atalhos no `tsconfig.json` e no `vitest.config.mts`). |
| Servidor | `hub/features/instagram/servidor/` | O antigo `Backend/api`: composition root, rotas (Fastify) e os adaptadores, ligados ao hub. |
| Telas | `hub/features/instagram/tela/` + `hub/app/instagram/` | O antigo painel, com os componentes dele e as cores ligadas às do hub (`hub/app/instagram.css`). |
| Ligação com o hub | `hub/features/instagram/servicos/` | `plataforma.ts` (monta tudo uma vez por processo), `repassar.ts` (pedido do navegador → rotas), `agenda.ts` (tarefas automáticas). |

- **Rotas:** `app/api/instagram/[...caminho]` exige login e a tela Instagram e repassa o pedido ao Fastify em processo
  (`app.inject`, nunca escuta porta), dentro da organização aberta, com a pessoa no cabeçalho `x-instagram-usuario`.
  Abertas, sem login: `app/api/instagram/midia/...` (links de mídia, protegidos pela assinatura) e
  `app/api/instagram/integrations/instagram/callback` (volta do login do Instagram, protegida pelo `state`).
- **Banco:** `instagram_documentos` (cada agregado como documento versionado, por organização) e `instagram_eventos`
  (histórico e feed da tela Início). Migração `0008_instagram`.
- **Tarefas automáticas** (`servicos/agenda.ts`, ligada no `instrumentation.ts`): a cada minuto publica o que chegou
  na hora, em cada organização; na subida, a peça que estava produzindo vira "falhou" com o motivo ("Tentar de novo"
  na tela) e a que esperava na fila volta para a fila. O hub roda numa réplica só (duas publicariam em dobro).

## Ferramentas: as do hub, sem segunda conexão

| Etapa | No projeto de origem | No hub |
| --- | --- | --- |
| Leitura da conta de referência | Apify (token no painel) | Apify, token em **Integrações** (cartão Apify) |
| Legenda e revisão por IA | Claude (chave no painel) | A chave do Claude do hub (Integrações → Claude) |
| Remoção de legendas | vMake (chaves no painel) | vMake, chaves em **Integrações** (cartão vMake) |
| Tradução do reel | HeyGen por chave de API | O login do HeyGen do hub, **sempre no modo rápido** (como todo o hub, contexto do Sávio) |
| Dublagem | ElevenLabs por chave de API | O login do ElevenLabs do hub (nó de dublagem "Dubbing v2" num flow) |
| Transcrição (legendas e revisor) | ElevenLabs | A transcrição do hub (Whisper no servidor de edições, Scribe de reserva): não depende de login |
| Edição do reel | Remotion no próprio servidor | Servidor de edições (trabalho `instagram-reel`): o Remotion desenha os textos (`remotion/ReelInstagram.tsx`) e o ffmpeg sobrepõe ao vídeo, como a camada das outras edições |
| Imagens (slides e capa) | FLORA por chave de API | O login do FLORA do hub; padrão Nano Banana 2.1 (`i2i-elote-gateway`) e os modelos de imagem do estúdio de Geração |
| Mídia | Bucket do Railway (`midia`) | Cada arquivo vira uma geração do hub (`tool: "instagram"`): **vídeo só no Google Drive** (pasta "Instagram"), imagem no disco do hub. Link permanente e público: `<hub>/api/instagram/midia/<organização>/<assinatura>/<chave>` |
| Publicação | Instagram API with Instagram Login | A mesma, com o app da Meta em **Integrações** (cartão Instagram) e o login de cada conta em Instagram → Configurações |

Sem Google Drive conectado na organização, os reels param na primeira etapa com o aviso de conectar o Drive (regra do
dono: vídeo só no Drive). Carrosséis não dependem do Drive.

## Instagram: o app da Meta e as contas

1. Integrações → cartão **Instagram (app da Meta)**: colar o ID do app e a chave secreta (Meta for Developers → o app →
   Instagram → API setup with Instagram login).
2. No app da Meta, em **OAuth redirect URIs**, cadastrar o endereço do hub:
   `https://hubdecriativos.up.railway.app/api/instagram/integrations/instagram/callback` (a aba Configurações mostra o
   endereço certo de cada hub, com botão de copiar).
3. Instagram → Configurações → Integrações → **Conectar conta do Instagram**, escolhendo o país. O token (60 dias) fica
   cifrado com `HUB_CHAVE_SEGREDOS` e é renovado sozinho perto de vencer, na hora de publicar.
4. A **publicação real** de cada conta começa desligada (publicação simulada); só dono e admin ligam.

## Migração (29/10/2026)

O banco de produção do projeto de origem tinha só a configuração: os mercados América Latina e França, as contas
`@momentodeoracionsb` e `@momentdepriere.fr` (nenhuma conectada ao Instagram), a conta de referência
`@santaespiritualidade` e as chaves do Apify, da vMake e do Claude. Nenhum post, peça, aprovação ou publicação.

- Mercados, contas, conta de referência e o histórico entraram na Grupo Chegou com os mesmos ids, pela rota
  `POST /api/instagram/admin/import` (só dono e admin; rodar de novo não duplica; `servidor/composition/data-import.ts`).
- As chaves do Apify e da vMake foram coladas em Integrações (cifradas com a chave do hub). O Claude usa a chave que o
  hub já tinha.
- Não havia conta do Instagram conectada nem app da Meta salvo: isso se faz no hub (passos acima).
- Os links de oferta dos mercados ainda são os de exemplo do projeto de origem (`sanbenito.example.com`): ajuste em
  Instagram → Mercados.
- Cópia do banco de origem: `Documentos\Grupo Chegou\Backups` (dump do Postgres do "Agente Instagram").

## Agentes e instruções

- O agente de conteúdo do projeto (`instagram-content-adapter`) virou o agente **Conteúdo Instagram** do chat
  (`lib/agent-profiles.ts`).
- As skills de Instagram (`ig-*`, `instagram-marketing` e `_shared`) estão em `.claude/skills/` na raiz deste
  repositório, para o Claude Code aberto nele.
- Os agentes de programação do projeto de origem (backend, painel e revisor de arquitetura) descreviam aquele
  repositório e não vieram; as regras do núcleo continuam valendo: domínio puro, estado só por métodos com nome de
  negócio, casos de uso publicam os eventos depois de salvar (leia `nucleo/*/domain` antes de mudar uma regra).

## Testes

`npm test` roda também os testes do núcleo e do servidor do Instagram (`features/instagram/**/*.test.ts`), com o banco
em memória do hub. O fluxo completo pela API está em `servidor/e2e/platform-flow.test.ts`; a importação, em
`servidor/e2e/data-import.test.ts`.
