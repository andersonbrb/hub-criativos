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
- `media/`: imagens, áudios e arquivos enviados pelas pessoas, servidos por `/api/media/<arquivo>`. **Vídeos gerados não ficam aqui:** veja "Vídeos no Google Drive" abaixo.
- `chats/<id>.json`, `board.json` (Fluxo), `editor/`, `analysis/` (decupagens em cache), `agents/` (personalização dos agentes), `ad-writer/` (nichos), `heygen-avatars.json` e `<serviço>-mcp.json` (sessões OAuth). Na raiz, para todas: `montagem/` (logs), `models/` e `tmp/`.

No Railway essa pasta é o volume montado em `/app/.data`. Ela nunca vai para o git.

Em andamento (leia `PLANO-HUB.md`): Postgres pelo Drizzle (`hub/db/`) e funcionalidades novas em `hub/features/<nome>/`. Testes: `npm test` (vitest com Postgres em memória). Antes de `npx tsc --noEmit`, rode `npx next typegen`, que gera os tipos globais `PageProps`/`LayoutProps`.

### Geração: a unidade de tudo
Tudo que é gerado ou enviado vira uma `Generation` (`lib/generations.ts`), com `tool`, `kind`, `status` e `file`. Os jobs assíncronos (FLORA, HeyGen, tradução, montagem) são atualizados por `refreshGeneration` (`lib/server/actions.ts`), que baixa o resultado para `media/` porque os links das ferramentas expiram. Montagem, exportação do editor e tradução prontas entram sozinhas na Biblioteca (`autoSave` em `store.ts`).

### Vídeos no Google Drive (regra do dono)
Todo vídeo gerado mora **só** no Drive de uma conta Google, na pasta "Hub de Criativos/<tipo>" (`features/drive`). Ao ficar pronto, `guardarNoDrive` (`features/drive/servicos/videos.ts`) sobe o vídeo, grava `drive: { id, pasta }` na geração e apaga a cópia local. Sem Drive conectado (ou se o envio falhar), o vídeo fica no disco marcado `params.paraDrive`; o espelho dispara a migração sozinho quando o Drive volta (e o botão "Levar vídeos antigos para o Drive", em Integrações, força na hora). Antes de apagar a cópia local, o tamanho no Drive é conferido.
- **Ler vídeo do disco:** sempre por `await arquivoLocal(file)`, que baixa uma cópia temporária do Drive (`.data/tmp/drive`, limpa sozinha). Nunca `path.join(await pastaDeMidia(), file)` para vídeo.
- **Uma conta Google por organização** (`drive_conta.organizacao_id`). A mesma conta Google não serve a duas organizações.
- **Mostrar:** `/api/media/<file>` repassa do Drive com Range. Os componentes não mudam.
- **Espelho:** `sincronizarComDrive` marca `foraDoDrive` o que foi apagado ou foi para a lixeira no Drive (e acompanha nomes); as listas escondem. Apagar no hub manda para a lixeira do Drive.
- **Acesso:** escopo `drive.file` (o hub só vê o que criou; não exige verificação do Google). Tokens cifrados com `HUB_CHAVE_SEGREDOS`. Passo a passo e variáveis em `docs/google-drive.md`.
- **Pasta escolhida:** a "Hub de Criativos" fica na raiz do Meu Drive ou dentro da pasta escolhida na janela do Google (Picker, `features/drive/tela/escolher-pasta.tsx`), gravada em `drive_conta.pasta_*`. Só a janela libera para o `drive.file` uma pasta que o hub não criou. A pasta pode estar num Drive compartilhado: todo pedido ao Google leva `supportsAllDrives` e as buscas, `BUSCA_EM_TODOS_OS_DRIVES` (`servicos/pastas.ts`). Chamada nova à API do Drive precisa deles.

### YouTube (envio dos vídeos prontos)
Cada organização conecta o próprio canal (card YouTube em Integrações) e envia vídeos prontos pelo botão do YouTube no `GenerationCard` (`features/youtube/tela/enviar-para-o-youtube.tsx`): título, descrição, visibilidade, agora ou agendado, miniatura, Shorts, "para crianças". Regra do dono: nada sobe sozinho (nem ao mover cartão, nem ao terminar edição). Passo a passo do Google e limites em `docs/youtube.md`.
- **Conexão** (`servicos/conta.ts`): mesmo cliente OAuth do Google do Drive (chaves em Integrações), conexão separada (`youtube_conta`, um canal por organização, canal único entre organizações). Escopos só `youtube.upload` e `youtube.readonly`: o hub não apaga nem edita o que está no canal.
- **Envios** (`servicos/envios.ts`, tabela `youtube_envios`): "agendado" fica no hub até a hora (nada vai ao YouTube antes); "enviando" sobe em pedaços (`servicos/subir.ts`) com a sessão do Google guardada cifrada, para continuar depois de um reinício sem vídeo repetido. A fila roda a cada minuto (`hub/instrumentation.ts`) e a cada pedido, no máximo 2 por vez, cada envio dentro da organização dele (`comOrganizacao`). Erros do YouTube viram frase simples em `traduzirErro`; `ErroDoYoutube.passageira` decide o que tenta de novo sozinho.
- **Permissão:** conectar pede a chave `integracoes`; enviar pede a chave `youtube` (restrita: fora do "marcar tudo").

`lib/server/actions.ts` concentra as ações dos estúdios. As rotas da interface e as ferramentas do chat usam esse mesmo arquivo, então mude a regra lá e não em um dos lados.

### Serviços externos: MCP remoto com OAuth, não API
HeyGen, FLORA, ElevenLabs e Higgsfield são chamados pelos MCPs oficiais, com login OAuth da conta. O consumo sai dos créditos do plano de cada serviço, não do saldo de API.
- O cliente genérico fica em `lib/server/mcp-client.ts`. Os adaptadores ficam em `lib/server/providers/*` e em `heygen-mcp.ts`.
- O login é o botão "Conectar" da tela Integrações, feito direto no servidor que vai usar a sessão.
- O ElevenLabs lê os metadados OAuth do hub em `/oauth/<id>-client.json`. Por isso `HUB_PUBLIC_URL` precisa ser público e em HTTPS.
- Higgsfield: as edições de IA foram removidas. Sobraram os créditos (rodapé do menu) e o status de jobs antigos.

### Chaves das integrações: na tela, não em variáveis (regra do dono)
Chaves de API (Claude, Venice), o cliente OAuth do Google (Drive) e o modelo do chat na nuvem são colados na tela Integrações (`features/integracoes`). Ficam no banco, cifrados com `HUB_CHAVE_SEGREDOS`; no PC sem banco, em `.data/integracoes.json`.
- Leia sempre por `lerChave()` (`features/integracoes/servicos/chaves.ts`) ou `requireKey()` (`lib/server/env.ts`). Nunca por `process.env`.
- Integração nova com chave: acrescente em `CHAVES` (`features/integracoes/contrato.ts`) e ponha o campo no card dela. Nada de variável nova.
- As variáveis antigas (`ANTHROPIC_API_KEY`, `VENICE_API_KEY`, `HUB_API_MODEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `<SERVIÇO>_MCP_SESSION`) só servem de ponto de partida: o valor entra no hub na primeira leitura.
- Variáveis de verdade são só o que o servidor precisa antes de abrir uma tela: banco, `HUB_CHAVE_SEGREDOS`, `HUB_PUBLIC_URL`, `DONOS_DA_PLATAFORMA`, `PORT`.

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

### O comportamento dos agentes é texto, não código
- `lib/server/chat/system.ts` monta o prompt base (regras de custo, b-roll, FLORA e Fluxo) e acrescenta todos os `hub/playbooks/*.md`.
- `lib/agent-profiles.ts` é a definição única de cada agente (Estrategista, Copy, VSL…). A lista da página Agentes (`/agentes`) e da busca rápida ainda vem de `lib/data.ts` (dados de exemplo do protótipo), então os ids dos dois arquivos precisam bater.
- A personalização feita pelo usuário ("Editar agente") fica em `agents/<id>.json`, na pasta da organização, e entra no fim do prompt.
- `hub/playbooks/contexto-grupo-chegou.md` é dado do negócio da Grupo Chegou: só entra no prompt das conversas dela (`SO_DA_ORGANIZACAO_PADRAO` em `system.ts`).
- `lib/server/ad-writer.ts` usa a base `hub/knowledge/ad-writer-light`. Ela é só local (sem licença) e fica fora do git.

### Vídeo local, sem custo
- Scripts em `hub/scripts/`: edição final (`montage.ts` → `montagem.py`), edição na batida (`batida.py`), remover legenda com LaMa (`remover_legenda.py`) e Whisper de reserva (`transcrever.py`). Cada script recebe um `job.json`, roda em segundo plano e grava o log em `.data/montagem/<id>.log`.
- Gráficos animados: o Remotion (`hub/remotion/`) desenha PNGs transparentes e o ffmpeg do sistema os sobrepõe ao vídeo (`lib/server/motion.ts`).
- Editor (`lib/editor.ts` + `lib/server/editor.ts`): clipes e legendas guardam o tempo da mídia de origem. A prévia usa o Remotion Player e a exportação usa o ffmpeg.
- Transcrição: ElevenLabs Scribe por padrão, Whisper local de reserva (`lib/server/transcription.ts`).
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
`hub/components/` é dividido por área: `chat`, `pipeline` (o Fluxo), `studios` e `editor`. Os componentes shadcn (estilo radix-nova) ficam em `components/ui`. O projeto usa Tailwind v4 e o tema padrão é o escuro. O design segue o estilo do ElevenLabs (superfícies planas, cinzas neutros, bordas finas, fonte Inter), com o azul do logo como cor de destaque: cores e a tela de entrar ficam em `app/designs.css`; a barra do topo (nome da página, busca Ctrl K e conta), o menu lateral e a busca rápida ficam em `components/topbar.tsx`, `app-sidebar.tsx` e `command-menu.tsx`, com a lista de telas em `components/nav.ts`. O menu é curto (regra do dono): Chat, Agentes, Criativo automático, Fluxo, Biblioteca, Estúdios, Editor, Memória e, no pé, Configurações. Agentes, Estúdios e Configurações são um item só, que abre a página do grupo com um cartão por tela (`components/grade-de-telas.tsx`); a busca rápida continua indo direto a cada tela. Tela nova entra num grupo existente antes de virar item do menu. O hub roda em tamanho real (100%); não volte a reduzir a escala da página.

**Tamanhos de tela (um ponto de troca só para o app inteiro, em `hooks/use-tela.ts`):** abaixo de 1024 px (`lg`; celular em pé e deitado, tablet em pé) o menu é gaveta, a busca do topo vira lupa e as telas de trabalho (`components/workspace.tsx`) mostram um painel por vez em abas; de 1024 a 1279 (`xl`) o menu começa recolhido em ícones e os layouts prontos viram um menu; a partir de 1280 tudo aberto; a partir de 1536 (`2xl`) as páginas de cartões e tabelas ficam mais largas. Altura até 500 px (celular deitado) tem a variante `baixa:` (barras mais baixas). Tela de toque: `pointer-coarse:` aumenta botões (`components/ui/button.tsx`) e mostra o que no computador só aparece com o mouse em cima. Tabela larga usa `<Table empilhar>` com `data-rotulo` nas células (vira cartões abaixo de 1024) e `COLUNA_DE_ACOES`. Tela nova segue esses pontos; não crie outros.

## Deploy (Railway)
O `Dockerfile` e o `railway.json` da raiz montam uma imagem com Node 22, ffmpeg, Python (faster-whisper, torch CPU, OpenCV), o Chrome headless do Remotion e as fontes, e fazem o build de `hub/`. Variáveis de lá:
- `DATABASE_URL`: o Postgres do projeto (referência ao serviço `Postgres`).
- `DONOS_DA_PLATAFORMA`: e-mails que podem operar a plataforma (separados por vírgula). O login é por conta (`features/acesso`); o primeiro dono sai de `npm run criar-dono -- --email X --nome "Nome"`, que faz a conta operar a plataforma e ser dona da Grupo Chegou. Os donos das outras organizações vêm do convite criado na tela Plataforma. `HUB_PASSWORD` não é mais usada.
- A memória de outra organização entra por `npm run importar-memoria -- <pasta> --organizacao <id>` (sem `--organizacao`, vai para a Grupo Chegou).
- `HUB_CHAVE_SEGREDOS`: cifra as chaves das integrações e a autorização do Google guardadas no banco.
- `HUB_PUBLIC_URL`: endereço público do hub.
- `HUB_CHAT` (opcional): `off` desliga o chat.
- As chaves das integrações não são variáveis: ficam em Integrações (veja acima).

Publicar é só commit + push na `main`: a produção implanta sozinha a partir dela.

### Acesso desta máquina à produção
- O Railway logado no CLI e na MCP deste PC é outra conta e **não enxerga o hub**. O acesso à produção é um token de projeto que fica na Central de Projetos (regra do dono: todos os tokens num lugar só), em `C:/Users/Vinic/OneDrive/Documentos/Central de Projetos/tokens/railway-hub-criativos.txt` (o arquivo tem só o token). Leia de lá na hora de usar, direto para a variável do comando ou para o cabeçalho (ex.: `RAILWAY_TOKEN="$(cat "<arquivo>")" railway ...`). Nunca copie o token para a pasta do projeto (nem num `.env`), nem para commit, log, rascunho ou resposta.
- Alcance: só o projeto "Hub de Criativos" (workspace "GC Pro Compartilhado's Projects"), ambiente `production`, com os serviços Hub Produção, Hub Teste, Postgres Produção e Postgres Teste. Não lista outros projetos nem a conta.
- Uso: API GraphQL `https://backboard.railway.com/graphql/v2` com o cabeçalho `Project-Access-Token` (não `Authorization: Bearer`), ou `RAILWAY_TOKEN` no ambiente do CLI. Lê variáveis, publicações e os registros do servidor e da montagem. Ao ler variáveis, mostre só os nomes, nunca os valores.
- Pelo tipo (token de projeto), ele também consegue mudar variáveis, publicar e reiniciar nesse ambiente. Só faça isso quando o dono pedir aquela mudança.

## Outros arquivos da raiz
- `prototipo-hub.html`: protótipo estático original. Não faz parte do app.
- `.claude/skills/` + `skills-lock.json`: skills do Higgsfield para as sessões do Claude Code neste repositório. Também não fazem parte do app.
