# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

Hub de Criativos: app web (Next.js) para produzir criativos de anúncio (Meta e TikTok) do Grupo Chegou. Reúne num só lugar o chat com agentes, os estúdios (FLORA, ElevenLabs, HeyGen), a edição de vídeo local e um quadro Kanban (o "Fluxo"). Roda no PC do dono (uso principal) e no Railway.

O dono não é programador. Textos da interface, mensagens de erro, comentários e mensagens de commit são em português do Brasil. Os commits descrevem o efeito para quem usa (veja `git log`).

## Comandos

O app inteiro fica em `hub/`. A raiz só tem o deploy.

```bash
cd hub
npm install
npm run dev          # http://localhost:3000
npm run lint
npx tsc --noEmit     # checagem de tipos (não há script para isso)
npm run build
```

Não há testes automatizados. Para conferir uma mudança, rode o app e use a tela.

Edição, transcrição e "remover legenda" precisam de programas fora do Node: `ffmpeg` e `ffprobe` no PATH (ou `FFMPEG_BIN`/`FFPROBE_BIN`), e Python com `faster-whisper numpy opencv-python-headless torch` (ou `PYTHON_BIN`). O `Dockerfile` da raiz é a referência do que precisa estar instalado.

## Next.js 16

`hub/AGENTS.md` (carregado por `hub/CLAUDE.md`) avisa que esta versão do Next tem mudanças que não estão no treinamento. Consulte `hub/node_modules/next/dist/docs/` antes de usar uma API. Exemplos já usados aqui: `hub/proxy.ts` (substitui o middleware), os tipos globais `PageProps<"/rota">` e `LayoutProps`, e `await connection()` nas páginas que leem o disco.

## Arquitetura

### Organizações (como no Cifra)
O hub é multiempresa. Cada organização tem a própria equipe e os próprios dados: gerações e mídias, conversas, Fluxo, editor, agentes personalizados, sessões das integrações (FLORA, HeyGen, ElevenLabs, Higgsfield), conta do Google Drive, Memória e conexões do Conector. Uma conta participa de várias organizações, com papel (`dono`, `admin`, `membro`) e telas liberadas em cada uma (`organizacao_membros`). A organização que já existia é a **Grupo Chegou**, de id fixo (`ORGANIZACAO_PADRAO` em `features/acesso/contrato.ts`).
- **Organização atual:** `organizacaoAtual()` / `comOrganizacao(id, fn)` (`features/acesso/servicos/organizacao-atual.ts`, AsyncLocalStorage). `route()` roda cada rota dentro da organização aberta na sessão; páginas caem na sessão do pedido; a MCP do hub (`?org=`), o Conector (a organização da conexão) e os links de arquivo (a do link) entram na deles. Fora disso, com banco, lança: nunca adivinhe a organização. No PC sem banco é sempre a padrão.
- **Todo dado novo é de uma organização:** arquivo pela pasta dela (`pastaDeDados()` / `pastaDeMidia()` em `lib/server/pastas.ts`), tabela com `organizacao_id` e filtro em toda consulta. Cache em memória com chave de organização (veja `lib/server/mcp-client.ts`, `features/drive/servicos/*`). Trabalho em segundo plano herda a organização do pedido; callback de processo filho usa `comOrganizacao` (veja `montage.ts`).
- **Usuario** (`features/acesso/contrato.ts`) é a pessoa vista na organização aberta: `papel`, `ativo` e `chaves` são de lá, e `organizacao` traz id, nome e situação (`null`: nenhuma ativa). `podeUsar` exige a organização ativa.
- **Telas:** seletor no topo do menu (`features/acesso/tela/seletor-de-organizacao.tsx`), Equipe (`/membros`: nome, papéis, convites, remover, sair), Plataforma (`/plataforma`, só `usuarios.opera_plataforma` + `DONOS_DA_PLATAFORMA`: cria organização com o convite do primeiro dono, renomeia, suspende). Convite para e-mail que já tem conta pede a senha de sempre.
- **Aba velha:** o `apiFetch` manda a organização da tela em `x-hub-organizacao`; se a sessão trocou em outra aba, a rota responde 409 (`codigo: organizacao_trocada`) e a tela recarrega.

### Dados: arquivos JSON em `hub/.data/`, sem banco
A organização padrão usa a raiz de `.data/`; cada outra organização tem a sua em `.data/organizacoes/<id>/`, com as mesmas pastas e arquivos. Modelos (LaMa), temporários e logs da montagem ficam na raiz para todas.
- `db.json`: todas as gerações da organização (`lib/server/store.ts`). Uma fila serializa as escritas, então passe sempre por `createGeneration`/`updateGeneration`.
- `media/`: imagens, áudios e arquivos enviados pelas pessoas, servidos por `/api/media/<arquivo>`. **Vídeo nenhum fica aqui** (nem gerado nem enviado), só de passagem até chegar ao Drive: veja "Vídeos no Google Drive" abaixo.
- `chats/<id>.json`, `board.json` (Fluxo), `editor/`, `analysis/` (decupagens em cache), `agents/` (personalização dos agentes), `ad-writer/` (nichos), `heygen-avatars.json` e `<serviço>-mcp.json` (sessões OAuth). Na raiz, para todas: `montagem/` (logs), `models/` e `tmp/`.

No Railway essa pasta é o volume montado em `/app/.data`. Ela nunca vai para o git.

Em andamento (leia `PLANO-HUB.md`): Postgres pelo Drizzle (`hub/db/`) e funcionalidades novas em `hub/features/<nome>/`. Testes: `npm test` (vitest com Postgres em memória). Antes de `npx tsc --noEmit`, rode `npx next typegen`, que gera os tipos globais `PageProps`/`LayoutProps`.

### Geração: a unidade de tudo
Tudo que é gerado ou enviado vira uma `Generation` (`lib/generations.ts`), com `tool`, `kind`, `status` e `file`. Os jobs assíncronos (FLORA, HeyGen, tradução, montagem) são atualizados por `refreshGeneration` (`lib/server/actions.ts`), que baixa o resultado para `media/` porque os links das ferramentas expiram. Montagem, exportação do editor e tradução prontas entram sozinhas na Biblioteca (`autoSave` em `store.ts`).

### Vídeos no Google Drive (regra do dono: vídeo só fica guardado no Drive)
Palavras do dono (2026-10-20): "não é pra tá armazenando vídeo em nenhum outro lugar, se tá aparecendo vídeo ali na biblioteca tem que ser do Drive". Todo vídeo, gerado ou enviado pela equipe (chat, editor, Fluxo, tradução, referências dos agentes → pasta "Enviados pela equipe"; Claude Code → "Entregas do Claude"), mora **só** no Drive da organização, na pasta "Hub de Criativos/<tipo>" (`features/drive`). Imagens e áudios continuam no disco (o dono não mudou essa parte).
- **Sem Drive, sem vídeo:** todo ponto que gera ou recebe vídeo chama `exigirDriveParaVideo()` antes de gastar crédito ou gravar (montagem, batida, sem legenda, editor, FLORA vídeo, HeyGen, tradução com vídeo, importação do FLORA, envios, anexos do chat, referências de agente, link do Claude Code). As telas mostram `AvisoSemDrive` (`features/drive/tela/aviso-sem-drive.tsx`, lê `/api/drive/estado`). No PC sem banco o Drive não conecta, então lá não há vídeo.
- **Vídeo novo pronto:** grave por `concluirComArquivo(id, { file, ... })` (`servicos/videos.ts`): marca pronto com `params.prazoNoHub` (12 h), sobe em segundo plano e apaga o arquivo se a geração sumiu. Upload criado já pronto: `params.prazoNoHub: prazoNoHub()` + `guardarNoDriveEmSegundoPlano`. O envio confere tamanho e MD5 (`enviarConferido`) antes de apagar a cópia local. Falhou: `params.paraDrive`, a faxina tenta de novo; passou do prazo, o arquivo sai e a geração vira `failed`.
- **Mostrar:** vídeo pronto sem `drive` não aparece como pronto (`videoForaDoDrive`/`apareceNasListas` em `lib/generations.ts`): a Biblioteca, o Fluxo, o editor e o "Listar a Biblioteca" do conector escondem; o `GenerationCard` mostra "Guardando no Google Drive".
- **Faxina** (`servicos/faxina.ts`, ligada em `instrumentation.ts`: na subida e a cada 5 min, em cada organização): leva a fila ao Drive, descarta os vencidos, apaga cópias de vídeos já no Drive, restos soltos na mídia (sem geração, de depois de `.data/videos-so-no-drive.json`) e pastas de trabalho órfãs em `.data/tmp`. Vídeo antigo sem prazo nunca é apagado sem chegar ao Drive; soltos antigos vão para "Recuperados do hub". O registro do servidor (`[videos-no-drive]`) diz, na subida, o que ficou no disco por organização.
- **Ler vídeo do disco:** sempre por `await arquivoLocal(file)`, que baixa uma cópia temporária do Drive (`.data/tmp/drive`). A cópia sai 30 min depois do último uso; trabalho longo segura com `segurarTemp` (máx. 12 h) e solta com `soltarTemp` no fim, com sucesso ou erro (soltar a última trava apaga na hora). Nunca `path.join(await pastaDeMidia(), file)` para vídeo. Arquivo intermediário de vídeo sai em `finally`.
- **Uma conta Google por organização** (`drive_conta.organizacao_id`). A mesma conta Google não serve a duas organizações.
- **Mostrar:** `/api/media/<file>` repassa do Drive com Range, em pedaços de no máximo 2 MB quando o player pede "até o fim" (`faixaComTeto` em `lib/server/media.ts`; baixar sem Range vem inteiro). Vídeo em lista (Biblioteca, Fluxo, estúdios, editor) usa `VideoNaTela` (`components/video-na-tela.tsx`), que só ganha o endereço perto da tela: cada vídeo passa pelo servidor, e uma tela com 280 vídeos baixava 38 MB e travava o hub para todos (medido em 28/10/2026). Lista nova de vídeos usa o mesmo componente.
- **Espelho:** `sincronizarComDrive` marca `foraDoDrive` o que foi apagado ou foi para a lixeira no Drive (e acompanha nomes); as listas escondem. Apagar no hub manda para a lixeira do Drive.
- **Acesso:** escopo `drive.file` (o hub só vê o que criou; não exige verificação do Google). Tokens cifrados com `HUB_CHAVE_SEGREDOS`. Passo a passo e variáveis em `docs/google-drive.md`.
- **Pasta escolhida:** a "Hub de Criativos" fica na raiz do Meu Drive ou dentro da pasta escolhida na janela do Google (Picker, `features/drive/tela/escolher-pasta.tsx`), gravada em `drive_conta.pasta_*`. Só a janela libera para o `drive.file` uma pasta que o hub não criou. A pasta pode estar num Drive compartilhado: todo pedido ao Google leva `supportsAllDrives` e as buscas, `BUSCA_EM_TODOS_OS_DRIVES` (`servicos/pastas.ts`). Chamada nova à API do Drive precisa deles.

### YouTube (envio dos vídeos prontos)
Cada organização conecta o próprio canal (card YouTube em Integrações) e envia vídeos prontos pelo botão do YouTube no `GenerationCard` (`features/youtube/tela/enviar-para-o-youtube.tsx`): título, descrição, visibilidade, agora ou agendado, miniatura, Shorts, "para crianças". Regra do dono: nada sobe sozinho (nem ao mover cartão, nem ao terminar edição). Passo a passo do Google e limites em `docs/youtube.md`.
- **Conexão** (`servicos/conta.ts`): mesmo cliente OAuth do Google do Drive (chaves em Integrações), conexão separada (`youtube_conta`, um canal por organização, canal único entre organizações). Escopos só `youtube.upload` e `youtube.readonly`: o hub não apaga nem edita o que está no canal.
- **Envios** (`servicos/envios.ts`, tabela `youtube_envios`): "agendado" fica no hub até a hora (nada vai ao YouTube antes); "enviando" sobe em pedaços (`servicos/subir.ts`) com a sessão do Google guardada cifrada, para continuar depois de um reinício sem vídeo repetido. A fila roda a cada minuto (`hub/instrumentation.ts`) e a cada pedido, no máximo 2 por vez, cada envio dentro da organização dele (`comOrganizacao`). Erros do YouTube viram frase simples em `traduzirErro`; `ErroDoYoutube.passageira` decide o que tenta de novo sozinho.
- **Permissão:** conectar pede a chave `integracoes`; enviar pede a chave `youtube` (restrita: fora do "marcar tudo").

`lib/server/actions.ts` concentra as ações dos estúdios. As rotas da interface e as ferramentas do chat usam esse mesmo arquivo, então mude a regra lá e não em um dos lados.

### Skala (botão "Gerar ganchos", desde 27/10/2026)
O Skala (painel de anúncios do grupo, repositório `Grupo-Chegou-2-0/skalaads`) manda criativos da aba Criativos do TikTok Ads para o chat principal, que já começa pedindo ganchos (`features/skala`; receita completa do lado do Skala em `docs/skala.md`).
- **Porta:** o servidor do Skala chama `POST /api/skala/criativos` com `Authorization: Bearer <chave>` e recebe o link `/chat?skala=<token>` (uso único, 2 h; no banco, `skala_entregas`, só o hash, com a organização e a chave de quem mandou). Vale uma chave da tela Chaves de API (seção "API do hub"; o criativo entra na organização dela) ou a chave fixa da variável `HUB_CHAVE_DO_SKALA` do Railway (Grupo Chegou), que continua valendo até ser tirada de lá. Sem chave válida, 401.
- **Link:** a página do chat pede login e volta, troca a sessão para a Grupo Chegou (`ORGANIZACAO_DO_SKALA`) se a pessoa participa, e a tela manda sozinha a 1ª mensagem. O POST do chat reserva a entrega, baixa a mídia e monta a mensagem (`servicos/primeira-mensagem.ts`): vídeo → Drive, como todo vídeo; "Ficha do Skala" em Markdown com copy, números e anúncios. Reabrir o link leva à mesma conversa.
- **Download** (`servicos/midia.ts`): só https, só os domínios de `DOMINIOS_DA_MIDIA` (Skala e CDNs do TikTok, da Meta e do Cloudinary), conferidos em cada redirecionamento; vídeo até 300 MB, imagem até 25 MB; tipo pelos primeiros bytes. O que não vem (link vencido, sem Drive) vira aviso na bolha e a conversa segue com a capa.
- Os anexos do chat ficam em `lib/server/chat/anexos.ts`, usados pela rota do chat e pelo Skala.

### API do hub (seção "API" do menu, pedido do dono, 28/10/2026)
Como a seção API do Skala: item "API" no pé do menu (página `/api-do-hub`), com **Documentação da API** (`/documentacao-da-api`, chave `integracoes`; texto em `features/api/documentacao.ts`, com os limites lidos do contrato do Skala) e **Chaves de API** (`/chaves-de-api`, só dono e admin: `soAdmin` em `components/nav.ts`).
- **Chaves** (`features/api`, tabela `chaves_api`): nome, começo (`hub_api_xxxx`), criada por, último uso, revogada. A chave inteira só volta na resposta de criar; no banco fica o SHA-256. Revogar vale na hora e não apaga a linha. Cada chave é de uma organização: o que ela manda entra lá.
- **Quem chama** (`quemChama` em `features/api/servicos/quem-chama.ts`): `Authorization: Bearer <chave>` vale com uma chave de API ou com a chave fixa `HUB_CHAVE_DO_SKALA` (sempre Grupo Chegou). Sem chave válida, 401.
- **Chamadas:** "Gerar ganchos" (`POST /api/skala/criativos`, a mesma que o Skala já usa) e "Conferir a chave" (`GET /api/chave-de-api`, devolve organização e nome da chave). Chamada nova: rota que usa `quemChama` e uma seção na documentação.

### Serviços externos: MCP remoto com OAuth, não API
HeyGen, FLORA, ElevenLabs e Higgsfield são chamados pelos MCPs oficiais, com login OAuth da conta. O consumo sai dos créditos do plano de cada serviço, não do saldo de API.
- O cliente genérico fica em `lib/server/mcp-client.ts`. Os adaptadores ficam em `lib/server/providers/*` e em `heygen-mcp.ts`.
- O login é o botão "Conectar" da tela Integrações, feito direto no servidor que vai usar a sessão. O cartão mostra a situação de verdade (`connectionStatus().situacao`: ativa, vencida ou desconectada; com o token vencido ele tenta renovar na hora) e sempre oferece conectar ou reconectar. Só a recusa do serviço vence o login; falha de rede não apaga nada.
- A variável antiga `<SERVIÇO>_MCP_SESSION` só entra quando o arquivo da sessão ainda não existe. Se fosse relida, a lixeira não apagaria e um login vencido voltaria como "Ativa" (o defeito de 20/10/2026). Na produção elas foram apagadas em 20/10/2026.
- O ElevenLabs lê os metadados OAuth do hub em `/oauth/<id>-client.json`. Por isso `HUB_PUBLIC_URL` precisa ser público e em HTTPS.
- Higgsfield: as edições de IA foram removidas. Sobraram os créditos (rodapé do menu) e o status de jobs antigos.

### Chaves das integrações: na tela, não em variáveis (regra do dono)
Chaves de API (Claude, Venice), o cliente OAuth do Google (Drive) e o modelo do chat na nuvem são colados na tela Integrações (`features/integracoes`). Ficam no banco, cifrados com `HUB_CHAVE_SEGREDOS`; no PC sem banco, em `.data/integracoes.json`.
- Leia sempre por `lerChave()` (`features/integracoes/servicos/chaves.ts`) ou `requireKey()` (`lib/server/env.ts`). Nunca por `process.env`.
- Integração nova com chave: acrescente em `CHAVES` (`features/integracoes/contrato.ts`) e ponha o campo no card dela. Nada de variável nova.
- As variáveis antigas (`ANTHROPIC_API_KEY`, `VENICE_API_KEY`, `HUB_API_MODEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `<SERVIÇO>_MCP_SESSION`) só servem de ponto de partida: o valor entra no hub na primeira leitura.
- Variáveis de verdade são só o que o servidor precisa antes de abrir uma tela: banco, `HUB_CHAVE_SEGREDOS`, `HUB_PUBLIC_URL`, `DONOS_DA_PLATAFORMA`, `PORT`. Exceção: `HUB_CHAVE_DO_SKALA`, a senha combinada com o Skala (seção Skala).

### Jeito padrão de trabalho: Claude Code no PC + Conector (regra do dono, 20/10/2026)
Palavras do dono: "o intuito é criar tudo pelo PC na maioria do tempo, para usar o Claude Code e não ficar gastando assinatura, então é uso padrão via o MCP do hub de criativos." Cada pessoa usa o Claude Code do próprio PC ligado ao hub da nuvem pelo Conector do Claude (`features/conector`, `/mcp`, login OAuth na tela "Conector do Claude"). Pelo Conector o Claude Code lê a Memória (as regras do Sávio chegam pela ferramenta `instrucoes`), lista e baixa da Biblioteca, mexe no Fluxo e entrega arquivos pelo `link_de_envio` (curl). Vídeo entregue vai para o Drive da organização (pasta "Entregas do Claude"); a resposta do curl espera o Drive (até 2 min, `ajustesDoEnvio`) e diz se o vídeo já está na Biblioteca. A criação (FLORA, HeyGen, ElevenLabs, kit do Sávio) acontece no próprio Claude Code. Testado de ponta a ponta com um Claude Code real em 20/10/2026 (`features/drive/testes/videos.test.ts`, "ponta a ponta pelo Claude Code"). A cópia do hub que abre direto no PC (sem banco) não é necessária nesse jeito de trabalhar.

### Chat e agentes: três "cérebros" com as mesmas ferramentas
`app/api/chat/route.ts` recebe a mensagem (FormData) e responde em NDJSON (`ChatEvent`). A rota escolhe um destes cérebros:
1. **Com o Claude Code instalado na máquina (o PC do dono), Claude Code local** (`lib/server/chat/claude-code.ts`). Roda o `claude.exe` da extensão do VS Code, logado na assinatura do dono, numa pasta isolada fora do repositório (`%LOCALAPPDATA%\HubCriativos\claude-code`). Não tem ferramentas de arquivo nem de comando: só WebSearch, WebFetch e a MCP do próprio hub. Serve apenas para uso pessoal do dono.
2. **Sem Claude Code (a nuvem)** (`chat/run.ts`): API da Anthropic com a chave e o modelo de Integrações → Claude, e loop de ferramentas próprio. A escolha é automática (`usesApiBrain`). `HUB_CHAT=off` desliga o chat.
3. **Modo Black** (`chat/venice.ts`): modelo da Venice. Converte o histórico na hora de enviar, sem reescrevê-lo.

As ferramentas ficam em `lib/server/chat/tools.ts` (`definitions` + `handlers`). No modo Claude Code elas chegam pela MCP do hub, em `app/api/mcp/route.ts`, com `?chat=<id>&org=<id>` e um token Bearer da organização (`mcpTokenDa`, derivado do segredo gerado a cada início do servidor). Cada resultado termina numa tag `<hub_result summary generations/>`, que o hub usa para montar os cards. Para adicionar uma ferramenta, crie a definição e o handler em `tools.ts` (isso vale para os três cérebros). Se o agente precisar saber quando usá-la, acrescente uma linha no prompt de sistema.

Regras que evitam quebrar conversas existentes:
- O prompt de sistema e a lista de ferramentas são congelados quando a conversa é criada, por causa do cache de prompt e dos blocos de thinking. Uma edição em playbook, agente ou prompt só vale para conversas novas.
- `chat.messages` está no formato da API da Anthropic e só cresce. Não reescreva mensagens antigas. Imagens ficam como `@file:<nome>` e são convertidas na hora em JPEG determinístico (`chat/images.ts`).
- Mantenha a ordem e o texto das definições de ferramenta estáveis. Uma ferramenta aposentada vai para `DEPRECATED` em vez de sumir.

### Como fazer vídeo: só o contexto do Sávio (regra do dono, 20/10/2026)
"Como fazer os vídeos vai ser só de acordo com o contexto do Sávio." Em roteiro, voz, avatar, b-roll, edição, legenda, áudio, entrega e revisão, a referência é o contexto do Sávio na Memória (documentos 02 a 12 e 22); o documento `decisoes-pendentes` (`hub/features/memoria/importacao/decisoes-pendentes.md`) diz a regra em cada ponto em que o hub era diferente e lista o que o Vinícius ainda decide. Regra nova de vídeo no prompt, num playbook, numa ferramenta ou numa tela segue o Sávio; onde ele não diz nada, pergunte ao dono (não invente nem mantenha a regra antiga do hub).
- As ferramentas seguem isso: edição final (`scripts/montagem.py`: legenda pelo roteiro, estilo drop/sb, música -32 LUFS sob a fala, entrega 720/1080 até 30 MB, formatos 9:16/4:5/1:1, CTA com setas, aviso), transcrição local primeiro, voz `eleven_multilingual_v2`, HeyGen sempre `speed`.
- A Memória da produção recebe o documento fechado e os playbooks novos sozinha ao subir o servidor (`features/memoria/servicos/decisoes-do-savio.ts`, chamado no `instrumentation.ts`): só troca documento que ainda é texto do hub; o editado na tela vai para a revisão. As versões antigas ficam no histórico do documento e em `hub/playbooks/historico/`.

### O comportamento dos agentes é texto, não código
- `lib/server/chat/system.ts` monta o prompt base (regras de custo, b-roll, FLORA e Fluxo) e acrescenta todos os `hub/playbooks/*.md`.
- `lib/agent-profiles.ts` é a definição única de cada agente (Estrategista, Copy, VSL…). A lista da página Agentes (`/agentes`) e da busca rápida ainda vem de `lib/data.ts` (dados de exemplo do protótipo), então os ids dos dois arquivos precisam bater.
- A personalização feita pelo usuário ("Editar agente") fica em `agents/<id>.json`, na pasta da organização, e entra no fim do prompt.
- O hub aprende pela Memória, não por treino de modelo (regra do dono, 27/10/2026): o pedido do usuário na conversa vale mais que as regras ("Pedido do usuário manda" em `system.ts`), e o chat grava sozinho as lições das correções e as regras que o usuário mandar mudar com `memoria_salvar` (chave `memoria_editar`; lição vai para `22-licoes-producao-video` marcada "precisa de revisão").
- Sem banco (PC), o documento das decisões entra no prompt junto dos playbooks, só nas conversas da Grupo Chegou (cita lotes dela). O retrato antigo `contexto-grupo-chegou.md` (06/10) foi para `hub/playbooks/historico/` e não entra mais no prompt.
- `lib/server/ad-writer.ts` usa a base `hub/knowledge/ad-writer-light`. Ela é só local (sem licença) e fica fora do git.

### Vídeo local, sem custo
- Scripts em `hub/scripts/`: edição final (`montage.ts` → `montagem.py`), edição na batida (`batida.py`), remover legenda com LaMa (`remover_legenda.py`) e Whisper (`transcrever.py`). Cada script recebe um `job.json`, roda em segundo plano e grava o log em `.data/montagem/<id>.log`.
- O Remotion é o motor visual de todas as edições (regra do dono, 27/10/2026): a composição `Camada` (`hub/remotion/Camada.tsx`) desenha legenda, palavras da batida, aviso, barra, setas do CTA e gráficos animados em PNGs transparentes, e o ffmpeg do sistema só corta, mistura o áudio e sobrepõe a camada (`aplicarCamada` em `lib/server/motion.ts`). Os scripts e o editor geram os dados da camada (`camada_out`) e um ASS de reserva: se o Remotion falhar, a legenda sai pelo ffmpeg; se nem isso, a edição falha (nunca sai sem legenda). As fontes vêm de `scripts/fonts` (`--public-dir`). Visual novo de edição entra na `Camada`, não em ASS nem em filtro do ffmpeg.
- Editor (`lib/editor.ts` + `lib/server/editor.ts`): clipes e legendas guardam o tempo da mídia de origem. A prévia usa o Remotion Player e a exportação usa o ffmpeg.
- Transcrição: Whisper local por padrão, um por vez na fila única (`naFilaDeCpu`), ElevenLabs Scribe de reserva (`lib/server/transcription.ts`).
- "Assistir" vídeo para os agentes (`lib/server/video.ts`): quadros, cortes e fala, em cache em `.data/analysis/`.

Nesta máquina Windows, o Controle de Aplicativo bloqueia a DLL do PyAV e o ffmpeg embutido do Remotion. Por isso os scripts leem o áudio pelo ffmpeg do sistema e usam um módulo `av` vazio no lugar do PyAV. Não troque por PyAV nem pelo ffmpeg do Remotion.

### Rotas e erros
As rotas de API são envolvidas em `route()` (`lib/server/http.ts`), que devolve `{ error }` em JSON. Os status são:
- entrada inválida (`InputError`): 400;
- chave faltando (`MissingKeyError`): 400;
- sem login (`NaoAutenticado`): 401; sem a chave da tela ou sem organização ativa (`SemPermissao`, `SemOrganizacao`): 403;
- a tela é de outra organização que não a aberta na sessão (`OrganizacaoTrocada`): 409;
- qualquer outro erro: 502.

As mensagens são em português, legíveis tanto para quem usa quanto para o agente. O código de servidor importa `"server-only"`.

### Interface
`hub/components/` é dividido por área: `chat`, `pipeline` (o Fluxo), `studios` e `editor`. Os componentes shadcn (estilo radix-nova) ficam em `components/ui`. O projeto usa Tailwind v4 e o tema padrão é o escuro. O design segue o estilo do ElevenLabs (superfícies planas, cinzas neutros, bordas finas, fonte Inter), com o azul do logo como cor de destaque: cores e a tela de entrar ficam em `app/designs.css`; a barra do topo (nome da página, busca Ctrl K e conta), o menu lateral e a busca rápida ficam em `components/topbar.tsx`, `app-sidebar.tsx` e `command-menu.tsx`, com a lista de telas em `components/nav.ts`. O menu é curto (regra do dono): Chat, Agentes, Criativo automático, Fluxo, Biblioteca, Estúdios, Editor, Memória e, no pé, Integrações e Conector do Claude. Agentes e Estúdios são um item só, que abre a página do grupo com um cartão por tela (`components/grade-de-telas.tsx`); a busca rápida continua indo direto a cada tela. Não há página de Configurações (regra do dono; `/configuracoes` só redireciona): Equipe e Plataforma abrem pelo menu da organização, no pé do menu. Tela nova entra num grupo existente antes de virar item do menu. O hub roda em tamanho real (100%); não volte a reduzir a escala da página.

**Tamanhos de tela (um ponto de troca só para o app inteiro, em `hooks/use-tela.ts`):** abaixo de 1024 px (`lg`; celular em pé e deitado, tablet em pé) o menu é gaveta, a busca do topo vira lupa e as telas de trabalho (`components/workspace.tsx`) mostram um painel por vez em abas; de 1024 a 1279 (`xl`) o menu começa recolhido em ícones e os layouts prontos viram um menu; a partir de 1280 tudo aberto; a partir de 1536 (`2xl`) as páginas de cartões e tabelas ficam mais largas. Altura até 500 px (celular deitado) tem a variante `baixa:` (barras mais baixas). Tela de toque: `pointer-coarse:` aumenta botões (`components/ui/button.tsx`) e mostra o que no computador só aparece com o mouse em cima. Tabela larga usa `<Table empilhar>` com `data-rotulo` nas células (vira cartões abaixo de 1024) e `COLUNA_DE_ACOES`. Tela nova segue esses pontos; não crie outros.

**Páginas sem login** (`features/publico`): a apresentação do hub (o `/` para quem não entrou) e a Política de Privacidade (`/privacidade`), abertas no `proxy.ts`; o Google pede as duas para o login com Google (Drive e YouTube). Ao mudar o que o hub lê, guarda ou envia do Google ou do YouTube, atualize a política (`tela/politica.tsx`) e a data (`POLITICA_ATUALIZADA_EM` em `contrato.ts`). O e-mail de contato (`EMAIL_DE_CONTATO`) e o responsável (`RESPONSAVEL`: só "Grupo Chegou", sem razão social nem CNPJ, decisão do dono) ficam em `contrato.ts`; não troque sem pedido dele.

## Deploy (Railway)
O `Dockerfile` da raiz monta uma imagem com Node 22, ffmpeg, Python (faster-whisper, torch CPU, OpenCV), o Chrome headless do Remotion e as fontes, e faz o build de `hub/`. As configurações de publicação (checagem de saúde em `/api/saude` com 120 s, reinício se cair) ficam no próprio serviço do Railway, não num arquivo: o `railway.json` foi removido porque o serviço não o lia e o formato deixa de valer em 1º/12/2026. Os dois discos da produção (banco e arquivos do hub) têm cópia de segurança diária e semanal no Railway. Variáveis de lá:
- `DATABASE_URL`: o Postgres do projeto (referência ao serviço `Postgres`).
- `DONOS_DA_PLATAFORMA`: e-mails que podem operar a plataforma (separados por vírgula). O login é por conta (`features/acesso`); o primeiro dono sai de `npm run criar-dono -- --email X --nome "Nome"`, que faz a conta operar a plataforma e ser dona da Grupo Chegou.
- `SENHA_DO_DONO_DA_PLATAFORMA` (pedido do dono, 28/10/2026): o login de administrador do site fica nas variáveis, o e-mail no primeiro de `DONOS_DA_PLATAFORMA` e a senha aqui. A cada subida, `aplicarSenhaDoDonoDasVariaveis` (`features/acesso/servicos/donos.ts`, chamada no `instrumentation.ts`) faz essa senha valer para essa conta, e só para ela: cria a conta se faltar; se a senha era outra, troca e derruba as sessões dela. A senha nunca vai para código, commit, log ou resposta. Os donos das outras organizações vêm do convite criado na tela Plataforma. `HUB_PASSWORD` não é mais usada.
- A memória de outra organização entra por `npm run importar-memoria -- <pasta> --organizacao <id>` (sem `--organizacao`, vai para a Grupo Chegou).
- `HUB_CHAVE_SEGREDOS`: cifra as chaves das integrações e a autorização do Google guardadas no banco.
- `HUB_PUBLIC_URL`: endereço público do hub.
- `HUB_CHAT` (opcional): `off` desliga o chat.
- `HUB_CHAVE_DO_SKALA`: a chave combinada com o servidor do Skala (botão "Gerar ganchos"). O Skala guarda o mesmo valor do lado dele. Vazia, a conexão fica desligada.
- As chaves das integrações não são variáveis: ficam em Integrações (veja acima).

### Aprovação antes de ir ao ar (regra do dono, 24/10/2026)
Nenhuma mudança vai ao ar sem o Vinícius aprovar. O repositório é `Grupo-Chegou-2-0/hub-criativos` (mudou de organização em 24/10/2026). Commit + push na `main` só guarda a mudança no GitHub: no serviço **Hub Produção** a publicação automática fica **desligada**, e a produção só muda quando alguém aprova e publica o commit.
- **Aprovar e publicar:** o Vinícius, no Railway: projeto "Hub de Criativos" → serviço "Hub Produção" → `Ctrl + K` → "Deploy Latest Commit". Ou ele diz "pode publicar" e o Claude publica aquele commit pelo login (seção abaixo), nunca subindo a pasta local.
- **Por que mudou:** antes a aprovação vinha de graça: o projeto ficava num workspace do Railway em que a conta do GitHub dos envios (`vndarlan`) não era membro, e o Railway segurava cada envio em "esperando aprovação". Em 23/10/2026 o projeto passou para o workspace "Grupo Chegou", em que essa conta é membro, e o envio passou a ir ao ar sozinho. O GitHub não tem regra de aprovação (repositório privado no plano gratuito).
- **Enquanto a publicação automática do Hub Produção estiver ligada** (confira com o login: gatilho de publicação do serviço), não dê push sem o ok do dono para ir ao ar.
- O serviço Hub Teste não publica sozinho.

### Acesso desta máquina à produção (desde 24/10/2026: pelo login, sem token)
- Regra do dono: o acesso ao Railway é o login dele feito neste PC (conta viniciuschegouoperacional@gmail.com), que vale para a MCP do Railway e para a linha de comando (`railway`), já logados. Não use token de projeto e não peça token novo ao dono.
- O login enxerga todos os projetos do workspace "Grupo Chegou". Deste projeto é só o **"Hub de Criativos"** (id `decc4e81-4032-4894-b887-d8d3bffd7e07`, ambiente `production`), com os serviços **Hub Produção**, **Hub Teste**, **Postgres Produção** e **Postgres Teste**. Os outros projetos da conta não são deste projeto: não leia, não mude e não publique nada neles.
- Ler (serviços, publicações, registros, nomes de variáveis) pode sem pedido. Ao ler variáveis, mostre só os nomes, nunca os valores. Mudar variável, publicar, reiniciar ou mexer em disco e cópia de segurança, só quando o dono pedir aquela mudança. Nunca use a publicação da MCP que sobe a pasta local (`deploy`): a produção sai do GitHub.
- Se o login cair, há um token de projeto antigo de reserva na Central de Projetos (`C:/Users/Vinic/OneDrive/Documentos/Central de Projetos/tokens/railway-hub-criativos.txt`). Em 23/10/2026 ele já não valia; nesse caso, peça à Central em vez de usar ou copiar token. Nunca copie token para a pasta do projeto, commit, log ou resposta.

## Outros arquivos da raiz
- `prototipo-hub.html`: protótipo estático original. Não faz parte do app.
- `.claude/skills/` + `skills-lock.json`: skills do Higgsfield para as sessões do Claude Code neste repositório. Também não fazem parte do app.
