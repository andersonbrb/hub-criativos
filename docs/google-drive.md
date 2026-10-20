# Google Drive: onde os vídeos ficam guardados

## Visão geral

Regra do dono: **vídeo só fica guardado no Google Drive.** Os vídeos que o hub gera (edição final, edição na batida,
editor, tradução, sem legenda, b-rolls, avatar e entregas do Claude) e os que a equipe envia (chat, editor, Fluxo,
tradução, referências dos agentes) ficam **só** no Google Drive de uma conta Google, na pasta **Hub de Criativos**,
com uma subpasta por tipo (os enviados vão para **Enviados pela equipe**).

- **Sem Drive conectado, a organização não gera nem recebe vídeo.** As telas de vídeo mostram o aviso para conectar
  em Integrações, e o servidor recusa com a mesma explicação (também para o chat e o Claude Code). Imagens e áudios
  continuam no disco do hub, como antes.
- **Cópia temporária:** só enquanto o hub trabalha no vídeo (editar, transcrever, renderizar, subir ao Drive, ao
  HeyGen ou ao YouTube). Sai até 30 minutos depois do último uso; um trabalho longo a segura enquanto roda, **nunca
  mais de 12 horas**. Sobras de trabalho interrompido (servidor reiniciado, erro no meio) saem sozinhas.
- **Vídeo pronto:** sobe na hora para o Drive e só sai do hub depois de conferido lá (mesmo tamanho e mesma
  impressão digital). Se o Drive não aceitar, o hub tenta de novo sozinho por até 12 horas; passou disso, o vídeo é
  descartado e a geração aparece como falha, com o motivo. Até chegar ao Drive, o vídeo não aparece como pronto: o
  card mostra "Guardando no Google Drive" e a Biblioteca e o Fluxo não o mostram.
- **Faxina:** roda quando o servidor sobe e a cada 5 minutos (registro do servidor com o prefixo `[videos-no-drive]`).
  Na subida, ela escreve, por organização, quantos vídeos ainda estão no disco do hub e se a organização tem Drive.
- **Vídeos de antes da regra** que ainda estão no disco vão para o Drive quando a organização tem Drive conectado, e
  só saem daqui depois de conferidos. Organização sem Drive: eles ficam onde estão (nunca são apagados sem chegar ao
  Drive) e não aparecem nas listas. Vídeos soltos no disco, sem registro, de antes da regra, vão para a pasta
  **Recuperados do hub** no Drive antes de sair.

- Uma conta Google por organização (cada organização do hub conecta a sua). Pode ser um Gmail comum. A mesma conta
  Google não serve a duas organizações: o hub recusa e pede outra conta.
- Quem conecta e desconecta: só quem tem a chave **Integrações** na organização (tela Equipe).
- O cliente OAuth do Google (ID e chave secreta) é um só para o hub inteiro.
- O hub só enxerga os arquivos que ele mesmo criou no Drive (permissão `drive.file`). Ele não vê nem mexe no resto da
  conta. Arquivo posto à mão na pasta não aparece no hub.
- O que alguém apagar, renomear ou mandar para a lixeira nesses arquivos, direto no Drive, aparece no hub.
- O espaço é o da conta Google. No plano gratuito são 15 GB, divididos com o Gmail e o Google Fotos. O card do Drive em
  Integrações mostra quanto já foi usado.

A configuração tem três partes: criar o cliente OAuth no Google Cloud (uma vez), colar o ID e a chave secreta dele
no card do Drive (tela Integrações) e conectar a conta no mesmo card.

## 1. Criar o cliente OAuth no Google Cloud

Faça logado em qualquer conta Google (pode ser a mesma do Drive). Os nomes dos menus mudam de tempos em tempos; o
caminho abaixo é o de outubro de 2026.

1. Abra [console.cloud.google.com](https://console.cloud.google.com) e crie um projeto chamado **Hub de Criativos**
   (seletor de projetos no topo → **Novo projeto**).
2. **Ativar a API do Drive:** menu → **APIs e serviços** → **Biblioteca** → procure **Google Drive API** → **Ativar**.
3. **Tela de consentimento:** menu → **APIs e serviços** → **Tela de consentimento OAuth** (ou **Google Auth
   Platform**) → **Começar**.
   - Nome do app: **Hub de Criativos**.
   - E-mail de suporte: o seu.
   - Público: **Externo**.
   - Contato: o seu e-mail.
   - **Não envie logotipo.** Com logotipo o Google exige verificar a marca antes de liberar.
4. **Escopos (Acesso a dados):** adicione `.../auth/drive.file`, `openid`, `.../auth/userinfo.email` e
   `.../auth/userinfo.profile`. Nenhum deles é "sensível", então não há verificação do Google.
5. **Publicar em produção:** **Público** → **Publicar app** → confirme. O status deve ficar **Em produção**.
   Isto é obrigatório. Em "Teste", o Google desconecta o hub a cada 7 dias e só aceita os e-mails da lista de teste.
   Com `drive.file`, publicar não pede verificação e o login não vence.
6. **Criar o cliente:** **Clientes** (ou **Credenciais** → **Criar credenciais** → **ID do cliente OAuth**):
   - Tipo: **Aplicativo da Web**.
   - Nome: **Hub de Criativos**.
   - **URIs de redirecionamento autorizados**, os dois, exatamente assim:
     - `https://hub-criativos-production.up.railway.app/api/integracoes/google-drive/callback`
     - `http://localhost:3000/api/integracoes/google-drive/callback`
   - Origens JavaScript: deixe vazio.
7. Copie o **ID do cliente** e a **Chave secreta do cliente**. A chave secreta só aparece inteira na hora de criar;
   se perder, crie outra no mesmo cliente.

**Não apague esse projeto nem o cliente depois.** Para o Google, os arquivos criados pelo hub pertencem a este cliente.
Com um cliente novo, o hub deixa de enxergar os vídeos que já estão no Drive.

## 2. Colar o cliente no hub

No hub, abra **Integrações** → card **Google Drive** e cole o **ID do cliente** (termina em
`.apps.googleusercontent.com`) e a **Chave secreta do cliente**. Os dois ficam guardados no banco do hub, cifrados.
Não são variáveis do servidor. (As antigas `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, se existirem, entram no
banco sozinhas na primeira leitura e depois podem ser apagadas.)

O servidor precisa de duas variáveis, postas uma vez na criação do hub:

| Variável | O que é |
|---|---|
| `HUB_CHAVE_SEGREDOS` | Chave que cifra o que fica guardado no banco (chaves das integrações e autorização do Google). 32 bytes em base64. |
| `HUB_PUBLIC_URL` | Endereço público do hub. No Railway: `https://hub-criativos-production.up.railway.app`. |

Gere a `HUB_CHAVE_SEGREDOS` uma vez só:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Onde pôr:
- **Railway:** serviço `hub-criativos` → **Variables**. O serviço reinicia sozinho.
- **PC:** `hub/.env.local` (modelo em `hub/.env.example`) e reinicie o `npm run dev`. No PC, deixe `HUB_PUBLIC_URL`
  vazio ou `http://localhost:3000`; com o endereço do Railway, o Google mandaria a volta do login para o Railway.
  A conta do Drive fica no banco, então o PC só conecta o Drive com `DATABASE_URL` preenchida.

Sem o cliente colado, o card do Drive mostra os campos para colar. Sem `HUB_CHAVE_SEGREDOS` (ou com um valor que
não tem 32 bytes), o hub recusa guardar o cliente e conectar: ele não grava segredo sem cifrar.

## 3. Conectar a conta

1. No hub, abra **Integrações** → card **Google Drive** → **Conectar**.
2. Escolha a conta Google que vai guardar os vídeos.
3. Na tela do Google, deixe **marcada** a opção de acesso ao Google Drive. Sem ela o hub recusa a conexão e avisa.
4. O hub volta para Integrações com "Google Drive conectado". O card mostra a conta e o espaço usado.

Os vídeos que já estavam no disco do hub antes da conexão vão para o Drive sozinhos, um por vez (a faxina passa a
cada 5 minutos). O card mostra quantos ainda estão no hub. Para começar na hora, use o botão **Levar vídeos antigos
para o Drive**, no mesmo card. O progresso aparece ali e atualiza sozinho.

## 4. Escolher a pasta (opcional, inclusive num Drive compartilhado)

Sem escolher, a pasta **Hub de Criativos** fica na raiz do Meu Drive da conta conectada. Para ela ficar dentro de
outra pasta (por exemplo, uma pasta de um Drive compartilhado da empresa):

1. No mesmo projeto do Google Cloud: **APIs e serviços** → **Biblioteca** → procure **Google Picker API** →
   **Ativar**.
2. **APIs e serviços** → **Credenciais** → **Criar credenciais** → **Chave de API**. Em **Restrições da API**,
   deixe só a **Google Picker API**. Em **Restrições do aplicativo**, se quiser, escolha **Sites** e coloque o
   endereço do hub com `/*` no fim.
3. No hub, card **Google Drive** → cole a **Chave de API do Google**.
4. Clique em **Escolher pasta**. Abre a janela de pastas do próprio Google: escolha a pasta e confirme. O hub cria a
   **Hub de Criativos** lá dentro e os vídeos novos passam a ir para ela.

- A conta Google conectada precisa poder criar arquivos na pasta (no Drive compartilhado: **Administrador de
  conteúdo** ou **Gerente**).
- O hub continua sem enxergar o resto do Drive: só a pasta escolhida na janela e o que ele mesmo cria.
- Os vídeos que já estavam no Drive ficam onde estão. Só os novos vão para a pasta nova.
- Num Drive compartilhado o espaço é o da empresa, então o card não mostra o espaço usado.
- O ícone de voltar, ao lado de **Escolher pasta**, faz os vídeos novos voltarem para o Meu Drive.
- Conectar outra conta Google volta para o Meu Drive (a outra conta não enxerga a pasta escolhida).

## O que acontece se a conta for desconectada

- **Pelo botão Desconectar (Integrações):** o hub tira o próprio acesso na conta Google e apaga a autorização dele.
  Os vídeos continuam no Drive, mas o hub não toca nem baixa esses vídeos até a mesma conta ser conectada de novo.
  Enquanto isso, a organização não gera nem recebe vídeo (regra do dono). Um vídeo que estava subindo na hora da
  desconexão espera até 12 horas pela conta voltar; depois disso é descartado.
- **Pela própria conta Google** (acesso removido em [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
  troca de senha ou conta suspensa): na próxima vez que o hub precisar do Drive, o Google recusa. O hub então
  desconecta sozinho e o card volta a mostrar **Conectar**.
- **Reconectar a mesma conta:** tudo volta a funcionar. Os arquivos foram criados por este cliente OAuth, então o
  hub volta a enxergá-los.
- **Conectar outra conta:** a nova passa a receber os vídeos. Os da conta antiga continuam no Drive dela, mas o hub
  não os abre e eles **somem das listas do hub** (estúdios, Biblioteca, Fluxo). Eles voltam quando a conta antiga for
  conectada de novo: o hub não apaga esses registros, nem pelo botão "Limpar" dos estúdios. Por precaução, se a troca
  fizer sumir mais da metade dos vídeos de uma vez, o hub não esconde nenhum e só registra o aviso no log; nesse caso
  eles continuam nas listas, mas não tocam até a conta antiga voltar. Troque de conta só se não precisar dos vídeos
  antigos pelo hub.
- **Trocar a `HUB_CHAVE_SEGREDOS`:** o hub não consegue mais abrir a autorização guardada. O card pede para conectar
  de novo. Os vídeos não se perdem.
- **Apagar o projeto ou o cliente no Google Cloud:** o hub perde o acesso aos vídeos que já estão no Drive (veja o
  aviso no fim do passo 1).

## Problemas comuns

- **"Erro 400: redirect_uri_mismatch" no Google:** o endereço de volta não está cadastrado exatamente igual no
  cliente (passo 1.6). Confira `https`, a barra e o caminho `/api/integracoes/google-drive/callback`. Confira também
  o `HUB_PUBLIC_URL`.
- **"Acesso bloqueado: o app está em teste" ou desconexão a cada 7 dias:** falta publicar em produção (passo 1.5).
- **"O Google não verificou este app":** não deveria aparecer só com estes escopos. Se aparecer, confira se não há
  logotipo nem outros escopos na tela de consentimento.
- **"Faltou liberar o Google Drive":** na tela do Google, a caixa do Drive estava desmarcada. Conecte de novo e deixe
  marcada.
- **"O Google não liberou essa pasta para o hub":** a pasta foi escolhida fora da janela do Google, ou a janela usou
  outro projeto. Confira se a chave de API é do mesmo projeto do cliente OAuth e escolha de novo pela janela.
- **A janela de pastas não abre:** a Google Picker API não está ativada, ou a chave de API está restrita a outro site.
