# Google Drive: onde os vídeos gerados ficam guardados

## Visão geral

Os vídeos que o hub gera (edição final, edição na batida, editor, tradução, sem legenda, b-rolls, avatar e entregas do
Claude) ficam **só** no Google Drive de uma conta Google, na pasta **Hub de Criativos**, com uma subpasta por tipo.
O disco do hub guarda apenas cópias temporárias enquanto processa um vídeo.

- Uma conta Google para o hub inteiro. Pode ser um Gmail comum.
- Quem conecta e desconecta: só quem tem a chave **Integrações** (tela Membros).
- O hub só enxerga os arquivos que ele mesmo criou no Drive (permissão `drive.file`). Ele não vê nem mexe no resto da
  conta. Arquivo posto à mão na pasta não aparece no hub.
- O que alguém apagar, renomear ou mandar para a lixeira nesses arquivos, direto no Drive, aparece no hub.
- O espaço é o da conta Google. No plano gratuito são 15 GB, divididos com o Gmail e o Google Fotos. O card do Drive em
  Integrações mostra quanto já foi usado.

A configuração tem três partes: criar o cliente OAuth no Google Cloud (uma vez), pôr as variáveis no servidor e
conectar a conta na tela Integrações.

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

## 2. Variáveis

| Variável | O que é |
|---|---|
| `GOOGLE_CLIENT_ID` | O ID do cliente (termina em `.apps.googleusercontent.com`). |
| `GOOGLE_CLIENT_SECRET` | A chave secreta do cliente. |
| `HUB_CHAVE_SEGREDOS` | Chave que cifra a autorização do Google guardada no banco. 32 bytes em base64. |
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

Sem `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, o card do Drive mostra o que falta. Sem `HUB_CHAVE_SEGREDOS` (ou com
um valor que não tem 32 bytes), o hub recusa conectar: ele não grava a autorização do Google sem cifrar.

## 3. Conectar a conta

1. No hub, abra **Integrações** → card **Google Drive** → **Conectar**.
2. Escolha a conta Google que vai guardar os vídeos.
3. Na tela do Google, deixe **marcada** a opção de acesso ao Google Drive. Sem ela o hub recusa a conexão e avisa.
4. O hub volta para Integrações com "Google Drive conectado". O card mostra a conta e o espaço usado.

Os vídeos que já estavam no disco do hub antes da conexão vão para o Drive pelo botão **Levar vídeos antigos para o
Drive**, no mesmo card. O progresso aparece ali e atualiza sozinho.

## O que acontece se a conta for desconectada

- **Pelo botão Desconectar (Integrações):** o hub tira o próprio acesso na conta Google e apaga a autorização dele.
  Os vídeos continuam no Drive, mas o hub não toca nem baixa esses vídeos até uma conta ser conectada de novo. Os
  vídeos gerados nesse meio-tempo ficam no disco do hub, sem se perder, e vão para o Drive pelo botão **Levar vídeos
  antigos para o Drive** depois que a conta voltar.
- **Pela própria conta Google** (acesso removido em [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
  troca de senha ou conta suspensa): na próxima vez que o hub precisar do Drive, o Google recusa. O hub então
  desconecta sozinho e o card volta a mostrar **Conectar**.
- **Reconectar a mesma conta:** tudo volta a funcionar. Os arquivos foram criados por este cliente OAuth, então o
  hub volta a enxergá-los.
- **Conectar outra conta:** a nova passa a receber os vídeos. Os que estão na conta antiga continuam lá, mas o hub
  não os abre mais. Troque de conta só se não precisar dos vídeos antigos pelo hub.
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
