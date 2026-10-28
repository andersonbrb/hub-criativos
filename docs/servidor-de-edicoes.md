# Servidor de edições (serviço "Hub Edições" no Railway)

Pedido do dono (28/10/2026, "vale separar sim"): as edições de vídeo saem do servidor do site, para o hub não ficar
lento para todo mundo enquanto alguém edita. O código fica em `hub/features/edicoes`.

## O que roda onde

| Onde | O quê |
|---|---|
| **Hub Produção** (o site) | Telas, gerações, organizações, Google Drive. Baixa as entradas (do Drive ou da mídia), manda para o servidor de edições, mostra o registro na tela e, com o vídeo pronto, leva ao Drive como sempre. |
| **Hub Edições** (serviço novo) | Só calcula: edição final (`montagem.py` + Remotion + entrega do Sávio), edição na batida, remover legenda (LaMa), exportação do editor e a transcrição pelo Whisper. Sem banco, sem Drive, sem chave de integração. |

É a mesma imagem (`Dockerfile` da raiz). Com `HUB_SERVIDOR=edicoes` ela sobe `npm run servidor-de-edicoes`
(`hub/scripts/servidor-de-edicoes.ts`) em vez do site.

O site conversa com ele pela rede privada do Railway (`http://<serviço>.railway.internal:8080`), com a chave
combinada `HUB_CHAVE_DAS_EDICOES` (as duas pontas). Caminho de um trabalho: veja `hub/features/edicoes/contrato.ts`.

## Nada se perde num reinício

- **O site reinicia no meio** (publicação nova, queda): o pedido da edição fica em `.data/edicoes/<id>.json` até o fim.
  Na subida (`instrumentation.ts` → `retomarEdicoes`), o site volta a acompanhar o trabalho no servidor de edições,
  que continuou rodando; se a edição rodava no próprio site, ela recomeça do zero.
- **O servidor de edições reinicia no meio**: o trabalho some de lá, o site percebe ("desconhecido") e manda de novo,
  até 3 vezes.
- **O servidor de edições não responde** (fora do ar, chave errada, arquivo que não chegou): a edição roda no site,
  como antes da separação. O registro da edição e o log do servidor dizem isso ("a edição roda no servidor do site").
  Só a falha da própria edição (script, ffmpeg, Remotion) é final.
- **A troca de versão em si** (a primeira publicação com esta mudança): uma edição que estiver rodando no site antigo
  nessa hora morre com ele, porque o código antigo não guardava o pedido. Publique com nenhuma edição em andamento
  (processador do Hub Produção parado nos últimos minutos, veja abaixo).

## Configuração no Railway

Projeto "Hub de Criativos", ambiente `production`.

### Serviço Hub Edições
Criado em 28/10/2026: id `e46fd958-7741-46fa-93ac-eb24da25a4ba`, endereço privado `hub-edies.railway.internal`,
volume `hub-edições-volume` (`0d3aaa91-c909-49c2-87b7-19c266df0174`). Ficou sem fonte (e sem nenhuma versão no ar) até o
código desta mudança chegar à `main`.
- Fonte: repositório `Grupo-Chegou-2-0/hub-criativos`, ramo `main`, `Dockerfile` da raiz. Sem publicação automática
  (como o Hub Produção): ligar a fonte cria um gatilho de publicação; apague-o (`deploymentTriggerDelete`) e confira
  que `deploymentTriggers` do serviço volta vazio.
- Limite: 8 vCPU e 16 GB (a cobrança é pelo que usa; o limite só impede um pico sem fim).
- Variáveis: `HUB_SERVIDOR=edicoes`, `PORT=8080`, `HUB_CHAVE_DAS_EDICOES` (48 caracteres aleatórios, a mesma do site),
  `HUB_EDICOES_SIMULTANEAS=2`.
- Volume em `/app/.data`: guarda os modelos (Whisper em `/app/.data/hf`, LaMa em `/app/.data/models`), para não
  baixar de novo a cada vez que o serviço acorda. Os trabalhos ficam em `/app/.data/tmp/servidor-de-edicoes` e a pasta é
  esvaziada a cada subida.
- Checagem de saúde: `/api/saude` (aberta, sem dado nenhum). Reinicia se cair (`ON_FAILURE`).
- **Serverless ligado:** sem edição por 5 a 10 minutos, o serviço dorme e não gasta processador nem memória. O
  primeiro pedido acorda (o site espera até 3 minutos, repetindo enquanto o Railway responde 502).
- Sem domínio público: só a rede privada.

### Hub Produção (e Hub Teste)
- `HUB_SERVIDOR_DE_EDICOES=http://hub-edies.railway.internal:8080`
- `HUB_CHAVE_DAS_EDICOES`: o mesmo valor do Hub Edições (de preferência a referência
  `${{Hub Edições.HUB_CHAVE_DAS_EDICOES}}`; confira depois que o valor resolvido tem 48 caracteres).

Sem `HUB_SERVIDOR_DE_EDICOES`, o site edita nele mesmo (é o que acontece no PC). Apagar a variável e publicar volta
ao jeito antigo.

O mesmo Hub Edições pode atender o Hub Teste e o Hub Produção: ele não guarda nada de nenhum dos dois.

## Publicar (ordem segura)

1. Conferir que nenhuma edição está rodando: processador do Hub Produção perto de zero nos últimos 10 minutos
   (Railway → Hub Produção → Metrics).
2. Hub Edições: ligar a fonte (repositório e ramo acima) e publicar o commit. Esperar "Success" na checagem de saúde.
3. Hub Teste: as duas variáveis do site, publicar o mesmo commit, fazer uma edição de teste e conferir o vídeo.
4. Hub Produção: as duas variáveis (com `skipDeploys`) e publicar o commit aprovado.
5. Fazer uma edição e acompanhar: o registro da edição na tela, o log do Hub Edições (`[edicoes]`) e o processador do
   Hub Produção, que deve ficar baixo enquanto a edição roda.

## Testado

- Testes automáticos em `hub/features/edicoes/testes/servidor.test.ts`: envio, registro, vídeo de volta, chave, falha,
  site reiniciando no meio, servidor de edições reiniciando no meio, fora do ar (roda no site) e pedido retomado na
  subida.
- No PC (28/10/2026), com o servidor de edições em `localhost:8090` e Whisper, Python, Remotion e ffmpeg de verdade:
  edição final com b-rolls, título, setas do CTA e aviso (37 s), edição na batida com palavras (41 s) e exportação do
  editor com legenda (84 s), todas pelo servidor de edições. A mesma edição final feita no site saiu idêntica, byte a
  byte.

## Custo

Cobrança por uso (US$ 20 por vCPU/mês, US$ 10 por GB/mês, US$ 0,15 por GB de volume/mês; a rede privada não é
cobrada). Medido no Hub Produção de 21 a 28/10/2026: 247 vCPU-minuto na semana, 94% em picos de trabalho pesado.
Esses picos passam para o Hub Edições (o custo deles já existia, só muda de lugar). O que é novo: o serviço acordado
alguns minutos depois de cada edição e o volume dos modelos (cerca de 1,5 GB). Estimativa: US$ 1 a 2 por mês a mais.
