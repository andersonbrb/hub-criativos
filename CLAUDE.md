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

### Dados: arquivos JSON em `hub/.data/`, sem banco
- `db.json`: todas as gerações (`lib/server/store.ts`). Uma fila serializa as escritas, então passe sempre por `createGeneration`/`updateGeneration`.
- `media/`: imagens, áudios e arquivos enviados pelas pessoas, servidos por `/api/media/<arquivo>`. **Vídeos gerados não ficam aqui:** veja "Vídeos no Google Drive" abaixo.
- `chats/<id>.json`, `board.json` (Fluxo), `editor/`, `analysis/` (decupagens em cache), `agents/` (personalização dos agentes), `montagem/` (logs) e `<serviço>-mcp.json` (sessões OAuth).

No Railway essa pasta é o volume montado em `/app/.data`. Ela nunca vai para o git.

Em andamento (leia `PLANO-HUB.md`): Postgres pelo Drizzle (`hub/db/`) e funcionalidades novas em `hub/features/<nome>/`. Testes: `npm test` (vitest com Postgres em memória). Antes de `npx tsc --noEmit`, rode `npx next typegen`, que gera os tipos globais `PageProps`/`LayoutProps`.

### Geração: a unidade de tudo
Tudo que é gerado ou enviado vira uma `Generation` (`lib/generations.ts`), com `tool`, `kind`, `status` e `file`. Os jobs assíncronos (FLORA, HeyGen, tradução, montagem) são atualizados por `refreshGeneration` (`lib/server/actions.ts`), que baixa o resultado para `media/` porque os links das ferramentas expiram. Montagem, exportação do editor e tradução prontas entram sozinhas na Biblioteca (`autoSave` em `store.ts`).

### Vídeos no Google Drive (regra do dono)
Todo vídeo gerado mora **só** no Drive de uma conta Google, na pasta "Hub de Criativos/<tipo>" (`features/drive`). Ao ficar pronto, `guardarNoDrive` (`features/drive/servicos/videos.ts`) sobe o vídeo, grava `drive: { id, pasta }` na geração e apaga a cópia local. Sem Drive conectado (ou se o envio falhar), o vídeo fica no disco marcado `params.paraDrive`; o espelho dispara a migração sozinho quando o Drive volta (e o botão "Levar vídeos antigos para o Drive", em Integrações, força na hora). Antes de apagar a cópia local, o tamanho no Drive é conferido.
- **Ler vídeo do disco:** sempre por `await arquivoLocal(file)`, que baixa uma cópia temporária do Drive (`.data/tmp/drive`, limpa sozinha). Nunca `path.join(MEDIA_DIR, file)` para vídeo.
- **Mostrar:** `/api/media/<file>` repassa do Drive com Range. Os componentes não mudam.
- **Espelho:** `sincronizarComDrive` marca `foraDoDrive` o que foi apagado ou foi para a lixeira no Drive (e acompanha nomes); as listas escondem. Apagar no hub manda para a lixeira do Drive.
- **Acesso:** escopo `drive.file` (o hub só vê o que criou; não exige verificação do Google). Tokens cifrados com `HUB_CHAVE_SEGREDOS`. Passo a passo e variáveis em `docs/google-drive.md`.

`lib/server/actions.ts` concentra as ações dos estúdios. As rotas da interface e as ferramentas do chat usam esse mesmo arquivo, então mude a regra lá e não em um dos lados.

### Serviços externos: MCP remoto com OAuth, não API
HeyGen, FLORA e ElevenLabs são chamados pelos MCPs oficiais, com login OAuth da conta. O consumo sai dos créditos do plano de cada serviço, não do saldo de API.
- O cliente genérico fica em `lib/server/mcp-client.ts`. Os adaptadores ficam em `lib/server/providers/*` e em `heygen-mcp.ts`.
- O login é feito pela tela Integrações. Num servidor novo, a sessão pode vir de `<SERVIÇO>_MCP_SESSION` (o JSON em base64).
- O ElevenLabs lê os metadados OAuth do hub em `/oauth/<id>-client.json`. Por isso `HUB_PUBLIC_URL` precisa ser público e em HTTPS.
- As chaves `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY` e `FLORA_API_KEY` do `.env.example` não são usadas pelo código atual. Só `ANTHROPIC_API_KEY` e `VENICE_API_KEY` são lidas (`lib/server/env.ts`).
- Higgsfield: as edições de IA foram removidas. Sobrou só o status de jobs antigos, pela CLI.

### Chat e agentes: três "cérebros" com as mesmas ferramentas
`app/api/chat/route.ts` recebe a mensagem (FormData) e responde em NDJSON (`ChatEvent`). A rota escolhe um destes cérebros:
1. **Padrão, Claude Code local** (`lib/server/chat/claude-code.ts`). Roda o `claude.exe` da extensão do VS Code, logado na assinatura do dono, numa pasta isolada fora do repositório (`%LOCALAPPDATA%\HubCriativos\claude-code`). Não tem ferramentas de arquivo nem de comando: só WebSearch, WebFetch e a MCP do próprio hub. Serve apenas para uso pessoal do dono.
2. **`HUB_BRAIN=api`** (`chat/run.ts`): API da Anthropic com chave e loop de ferramentas próprio. É o modo da nuvem, onde não há Claude Code logado. Lá `HUB_CHAT=off` desliga o chat.
3. **Modo Black** (`chat/venice.ts`): modelo da Venice. Converte o histórico na hora de enviar, sem reescrevê-lo.

As ferramentas ficam em `lib/server/chat/tools.ts` (`definitions` + `handlers`). No modo Claude Code elas chegam pela MCP do hub, em `app/api/mcp/route.ts`, com um token Bearer gerado a cada início do servidor e `?chat=<id>`. Cada resultado termina numa tag `<hub_result summary generations/>`, que o hub usa para montar os cards. Para adicionar uma ferramenta, crie a definição e o handler em `tools.ts` (isso vale para os três cérebros). Se o agente precisar saber quando usá-la, acrescente uma linha no prompt de sistema.

Regras que evitam quebrar conversas existentes:
- O prompt de sistema e a lista de ferramentas são congelados quando a conversa é criada, por causa do cache de prompt e dos blocos de thinking. Uma edição em playbook, agente ou prompt só vale para conversas novas.
- `chat.messages` está no formato da API da Anthropic e só cresce. Não reescreva mensagens antigas. Imagens ficam como `@file:<nome>` e são convertidas na hora em JPEG determinístico (`chat/images.ts`).
- Mantenha a ordem e o texto das definições de ferramenta estáveis. Uma ferramenta aposentada vai para `DEPRECATED` em vez de sumir.

### O comportamento dos agentes é texto, não código
- `lib/server/chat/system.ts` monta o prompt base (regras de custo, b-roll, FLORA e Fluxo) e acrescenta todos os `hub/playbooks/*.md`.
- `lib/agent-profiles.ts` é a definição única de cada agente (Estrategista, Copy, VSL…). A lista do menu lateral ainda vem de `lib/data.ts` (dados de exemplo do protótipo), então os ids dos dois arquivos precisam bater.
- A personalização feita pelo usuário ("Editar agente") fica em `.data/agents/<id>.json` e entra no fim do prompt.
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
- qualquer outro erro: 502.

As mensagens são em português, legíveis tanto para quem usa quanto para o agente. O código de servidor importa `"server-only"`.

### Interface
`hub/components/` é dividido por área: `chat`, `pipeline` (o Fluxo), `studios` e `editor`. Os componentes shadcn (estilo radix-nova) ficam em `components/ui`. O projeto usa Tailwind v4, o design "Suíço" fica em `app/designs.css` e o tema padrão é o escuro.

## Deploy (Railway)
O `Dockerfile` e o `railway.json` da raiz montam uma imagem com Node 22, ffmpeg, Python (faster-whisper, torch CPU, OpenCV), o Chrome headless do Remotion e as fontes, e fazem o build de `hub/`. Variáveis de lá:
- `DATABASE_URL`: o Postgres do projeto (referência ao serviço `Postgres`).
- `DONOS_DA_PLATAFORMA`: e-mails que podem ser dono (separados por vírgula). O login é por conta (`features/acesso`); o primeiro dono sai de `npm run criar-dono -- --email X --nome "Nome"`. `HUB_PASSWORD` não é mais usada.
- `HUB_BRAIN`/`HUB_CHAT`: escolhem o cérebro do chat ou o desligam.
- `HUB_PUBLIC_URL`: endereço público do hub.
- `<SERVIÇO>_MCP_SESSION`: sessão OAuth de cada serviço.

## Outros arquivos da raiz
- `prototipo-hub.html`: protótipo estático original. Não faz parte do app.
- `.claude/skills/` + `skills-lock.json`: skills do Higgsfield para as sessões do Claude Code neste repositório. Também não fazem parte do app.
