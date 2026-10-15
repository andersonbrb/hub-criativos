# Railway: Hub de Criativos em produção

## Visão geral

O hub na nuvem roda no Railway, no workspace **Grupo Chegou**, projeto **Hub de Criativos**, ambiente `production`.
É a mesma imagem Docker do `Dockerfile` da raiz: Next.js (`hub/`), ffmpeg, Python (faster-whisper, torch CPU,
OpenCV), o Chrome headless do Remotion e as fontes.

O que mora onde:
- **Postgres** (serviço `Postgres`): contas, convites, sessões, memória e conexões do conector do Claude.
- **Volume do `hub`** (`/app/.data`): mídias, gerações, conversas, Fluxo, editor, decupagens, modelos do Whisper e
  do LaMa, e as sessões das integrações. É a mesma pasta `hub/.data/` do PC.

| Item | ID |
|---|---|
| Projeto | `9e6740cf-5d13-4b41-9c97-8022197f2ff6` |
| Ambiente `production` | `607c1a8b-e5dd-4e3e-9b4f-e17bc69da812` |
| Serviço `hub` | `71499abf-1f24-422e-9fea-569d235bb523` |
| Serviço `Postgres` | `26cebaad-7ef0-407e-b5d9-bbd40b4b9422` |
| Volume do `hub` (`hub-volume`) | `34896b74-9699-4fd6-b282-a20ff0a82b06` |

## Serviços

### `hub`
- Constrói pelo `Dockerfile` da raiz (`railway.json`: builder `DOCKERFILE`).
- Ao subir, roda as migrações e depois o servidor (veja [Migrações](#migrações)).
- Reinicia sozinho se cair (`ON_FAILURE`, até 5 tentativas).
- Tem um volume, então cada publicação tem alguns segundos fora do ar: o Railway não deixa duas versões montarem o
  mesmo volume ao mesmo tempo.

### `Postgres`
- Template oficial do Railway (imagem `postgres-ssl`, Postgres 18), com volume próprio.
- Acesso interno (rede privada do projeto): é o que o `hub` usa, pela `DATABASE_URL`.
- Acesso público por **TCP proxy**, só para rodar scripts do PC contra o banco de produção. O endereço completo, com
  usuário e senha, fica na variável `DATABASE_PUBLIC_URL` do serviço `Postgres`. Desligue o proxy (serviço
  `Postgres` → Settings → Networking) quando não estiver usando: é uma porta a mais aberta na internet.

### Volume `hub-volume`
- Montado em `/app/.data` no serviço `hub`.
- Nunca vai para o git. Some se o volume for apagado (com os backups dele).

## Variáveis

Só os nomes e para que servem. Os valores ficam no painel do Railway (serviço → Variables).

### Serviço `hub`
| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Endereço interno do Postgres. É a referência `${{Postgres.DATABASE_URL}}`: muda sozinha se a senha do banco mudar. |
| `HUB_PUBLIC_URL` | Endereço público do hub, em HTTPS. Usado pelo login das integrações (ElevenLabs lê `/oauth/<id>-client.json`) e pelo conector do Claude. Troque junto com o domínio. |
| `DONOS_DA_PLATAFORMA` | E-mails dos donos da plataforma, separados por vírgula. |
| `HUB_CHAT` | `off`: o chat interno e os agentes ficam desligados na nuvem (não há chave da Anthropic lá). O Claude Code de cada pessoa usa o hub pelo conector. |
| `NEXT_TELEMETRY_DISABLED` | `1`: o Next não envia telemetria. |
| `PORT` | `3000`: porta do servidor e da checagem de saúde. |

Opcionais, ainda não definidas no `hub`:
| Variável | Para que serve |
|---|---|
| `MCP_REDIRECTS_PERMITIDOS` | Para onde o login do conector (Claude na web) pode voltar. Vazio usa os endereços do claude.ai e do claude.com. |
| `HUB_BRAIN` / `HUB_API_MODEL` / `ANTHROPIC_API_KEY` | Ligam o chat interno na nuvem pela API da Anthropic (`HUB_BRAIN=api`) e escolhem o modelo. Junto, apague `HUB_CHAT=off`. |
| `<SERVIÇO>_MCP_SESSION` | Sessão OAuth de uma integração (JSON em base64). Normalmente não precisa: o login é feito na tela Integrações. |

O Railway também injeta as suas (`RAILWAY_*`), como `RAILWAY_PUBLIC_DOMAIN` e `RAILWAY_VOLUME_MOUNT_PATH`.

### Serviço `Postgres`
Vêm do template: `DATABASE_URL` (interna), `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `POSTGRES_*`,
`PGDATA`. Acrescentada à mão:
- `DATABASE_PUBLIC_URL`: o mesmo banco pelo TCP proxy, para usar do PC. É montada com referências
  (`PGUSER`, `POSTGRES_PASSWORD`, `RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT`, `PGDATABASE`), então
  acompanha a senha e o proxy.

## Domínio

- Domínio gerado pelo Railway: **https://hub-production-797d.up.railway.app** (porta 3000).
- Se trocar por um domínio próprio, atualize `HUB_PUBLIC_URL` e refaça o login das integrações que dependem do
  endereço (ElevenLabs) e as conexões do conector do Claude.

## Como publicar

Ainda não há fonte ligada ao serviço `hub`: nada foi publicado. Isso fica para a Onda 2, depois da junção.

Opção 1, repositório (recomendada):
1. No painel: serviço `hub` → Settings → Source → Connect Repo → `Grupo-Chegou-Geral/hub-criativos`, branch `main`.
2. Deixe a pasta raiz vazia (o `Dockerfile` e o `railway.json` ficam na raiz do repositório).
3. A partir daí, cada push na `main` publica sozinho.

Opção 2, pelo conector do Railway no Claude Code: ligar a fonte (`connect_service_source`) ou publicar a pasta
local, sempre no serviço `hub` deste projeto.

Depois de publicar, confira que a publicação ficou "Success" e abra `/api/saude`.

## Migrações

- Rodam ao subir: o `CMD` do `Dockerfile` é `npm run db:migrar && exec npm start` (o `exec` deixa o servidor
  receber o sinal de parada do Railway).
- `db:migrar` (`hub/scripts/migrar.mjs`) aplica o que falta de `hub/db/migrations` e não faz nada se o banco já
  estiver em dia. Sem `DATABASE_URL`, também não faz nada.
- Se a migração falhar, o servidor não sobe, a checagem de saúde não passa e a publicação fica marcada como falha.
  Como o `hub` tem volume, a versão anterior já pode ter saído do ar: confira logo. O motivo aparece no log da
  publicação.
- As migrações são geradas no PC (`npm run db:gerar`) e entram no git. Nunca escreva uma à mão.

## Como rodar scripts do PC contra o banco de produção

Use a URL pública do Postgres (`DATABASE_PUBLIC_URL`) como `DATABASE_URL` **só na sessão do terminal**. Nunca
coloque essa URL no `hub/.env.local` nem no git: com ela, qualquer pessoa lê e apaga o banco.

No PowerShell, dentro de `hub/`, com o Railway CLI logado:

```powershell
$env:DATABASE_URL = (railway variable list --project 9e6740cf-5d13-4b41-9c97-8022197f2ff6 --environment production --service Postgres --json | ConvertFrom-Json).DATABASE_PUBLIC_URL
npm run criar-dono -- --email <e-mail do dono> --nome "<nome>"
npm run importar-memoria -- <pasta>
Remove-Item Env:DATABASE_URL
```

Sem o CLI: copie `DATABASE_PUBLIC_URL` no painel (serviço `Postgres` → Variables) e use
`$env:DATABASE_URL = "<a URL>"`. Feche o terminal (ou rode o `Remove-Item`) ao terminar.

Se o banco estiver vazio, rode antes `npm run db:migrar` na mesma sessão (ou publique o hub uma vez).

## Saúde

- `GET /api/saude`, pública, sem cache.
  - `{ "ok": true, "banco": "ok" }`: servidor de pé e banco respondendo.
  - `{ "ok": true, "banco": "sem banco" }`: servidor sem `DATABASE_URL` (normal no PC sem banco).
  - `503 { "ok": false, "banco": "fora" }`: o banco não respondeu em 5 s. O motivo fica só no log.
- O Railway chama essa rota antes de liberar cada versão nova (`healthcheckPath`), com até 120 s de espera
  (`healthcheckTimeout`), porque o primeiro start roda a migração. A chamada vem do host `healthcheck.railway.app`.
- O Railway não monitora a rota depois que a versão entra no ar.

## Backups

- O Railway faz backup de **volumes**: o do Postgres e o do `hub`. Cada um tem a aba Backups no serviço.
  - Backup manual a qualquer hora, limitado a 50% do tamanho do volume.
  - Agendamentos: diário (guarda 6 dias), semanal (27 dias) e mensal (89 dias). Dá para ligar mais de um.
  - Cobrança só pelo que muda entre um backup e outro, no preço do volume.
  - A restauração monta um volume novo no lugar e publica de novo. Só restaura no mesmo projeto e ambiente.
  - Apagar o volume apaga os backups junto.
- **Os agendamentos ainda não foram ligados.** Ligue pelo menos o diário no `Postgres` e no `hub`.
- Antes de uma migração arriscada (apagar ou renomear coluna, mexer em dados), faça um `pg_dump` do PC, além do
  backup manual do volume:

```powershell
pg_dump --format=custom --no-owner --file "hub-$(Get-Date -Format yyyyMMdd-HHmm).dump" "<DATABASE_PUBLIC_URL>"
```

  O `pg_dump` precisa ser da versão 18 ou mais nova (a do servidor). Guarde o arquivo fora do repositório.
  Para voltar: `pg_restore --clean --no-owner --dbname "<DATABASE_PUBLIC_URL>" <arquivo>.dump`.

## Pendências conhecidas

- **Domínio próprio:** hoje é o domínio gerado pelo Railway. Trocar exige atualizar `HUB_PUBLIC_URL`.
- **Chat na nuvem:** sem chave da Anthropic, o chat interno fica desligado (`HUB_CHAT=off`). Para ligar, veja as
  variáveis opcionais acima.
- **Integrações:** depois do primeiro acesso, ligar FLORA, HeyGen e ElevenLabs na tela Integrações (login da conta).
- **Hub antigo:** está em outra conta do Railway. O endereço padrão de `HUB_PUBLIC_URL` no código (usado no PC
  quando a variável está vazia) já aponta para o hub novo.
- **Backups agendados:** ainda não ligados (veja [Backups](#backups)).
