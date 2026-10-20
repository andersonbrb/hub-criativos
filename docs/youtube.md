# YouTube: enviar os vídeos prontos para o canal

## Visão geral

Cada organização do hub conecta o próprio canal do YouTube (tela **Integrações** → card **YouTube**) e envia para ele os
vídeos prontos, pelo botão vermelho do YouTube no card do vídeo (Biblioteca, estúdios, Fluxo). Nada sobe sozinho: todo
envio parte desse botão.

- No envio: título, descrição, visibilidade (público, não listado ou privado), **enviar agora** ou **agendar** (dia e
  horário), miniatura (opcional), **É um Short** e **Feito para crianças**.
- O andamento aparece na própria janela do vídeo e no card do YouTube: agendado, enviando (com a porcentagem), enviado
  (com o link) ou falhou (com o motivo em linguagem simples e o botão **Tentar de novo**). Agendado e enviando têm
  **Cancelar**.
- **Agendado** fica no hub até a hora marcada; nada vai ao YouTube antes. Na hora, o hub sobe o vídeo com a
  visibilidade escolhida, e ele aparece no canal alguns minutos depois (o tempo de subir e de o YouTube processar). O
  hub da nuvem fica sempre ligado; se ele estiver fora do ar na hora, o envio sai assim que ele voltar.
- Um canal por organização. O mesmo canal não serve a duas organizações, e uma organização não vê nem mexe nos envios da
  outra.
- Quem conecta e desconecta: quem tem a chave **Integrações**. Quem envia: dono e admin, e quem receber a chave
  **Enviar vídeos ao YouTube** na tela Equipe (ela fica fora do "marcar tudo", porque publica em nome da empresa).
- Desconectar cancela os envios agendados daquele canal. Os vídeos já enviados continuam no YouTube; para tirar do ar,
  apague no YouTube Studio (o hub só tem permissão de enviar e de ler o canal, não de apagar).
- Shorts: o YouTube decide sozinho. Vídeo em pé (ou quadrado) de até 3 minutos vira Short. Marcar **É um Short** põe
  `#Shorts` na descrição, o que ajuda, mas não muda a regra.

## O que fazer no Google Cloud (uma vez)

O YouTube usa o **mesmo projeto e o mesmo cliente OAuth** do Google Drive (docs/google-drive.md). No mesmo projeto
**Hub de Criativos** do [console.cloud.google.com](https://console.cloud.google.com):

1. **Ativar a API do YouTube:** menu → **APIs e serviços** → **Biblioteca** → procure **YouTube Data API v3** →
   **Ativar**. Sem isso, o card mostra "A API do YouTube não está ativada".
2. **Endereço de volta:** **Clientes** (ou **Credenciais**) → abra o cliente **Hub de Criativos** → em **URIs de
   redirecionamento autorizados**, acrescente, exatamente assim:
   - `https://hubdecriativos.up.railway.app/api/integracoes/youtube/callback`
3. **Escopos (opcional):** em **Acesso a dados**, acrescente `.../auth/youtube.upload` e `.../auth/youtube.readonly`.
   Os dois são "sensíveis" para o Google. Com o app **Em produção** e sem verificação, o login funciona, mas o Google
   mostra antes a tela **"O Google não verificou este app"**: clique em **Avançado** → **Acessar Hub de Criativos**.
   App sem verificação aceita até 100 contas Google diferentes, o que sobra para o uso do hub.
4. O app precisa continuar **Em produção** (em "Teste", o Google derruba a conexão a cada 7 dias).

Para tirar o aviso de app não verificado, dá para pedir a verificação do Google (**Central de verificação**): ela pede
uma página de política de privacidade do hub, o domínio verificado e um vídeo mostrando o uso das permissões. Não é
obrigatória para funcionar.

## Limites do YouTube que afetam o uso

- **Cota diária do hub inteiro:** cada projeto do Google Cloud pode enviar **100 vídeos por dia**, somando todas as
  organizações (o cliente do Google é um só). A miniatura gasta de uma outra cota, grande (cerca de 200 por dia). A
  cota volta à meia-noite do horário do Pacífico: 4h ou 5h da manhã em Brasília. Acabou: o envio falha com o aviso, e
  **Tentar de novo** depois dessa hora resolve. Para mais, o Google pede o formulário de auditoria e aumento de cota
  ("YouTube API Services - Audit and Quota Extension Form").
- **Vídeo preso como privado:** desde 2020 o YouTube deixava como privado todo vídeo enviado por um app que não passou
  pela auditoria dele. Em outubro de 2026 a documentação do envio passou a dizer que isso não acontece mais, mas outras
  páginas ainda descrevem a regra antiga. O hub confere: se o YouTube deixar o vídeo com outra visibilidade, o envio
  mostra o aviso. Se acontecer, a saída é a mesma auditoria do item acima.
- **Canal sem verificação por telefone** ([youtube.com/verify](https://www.youtube.com/verify)): aceita vídeos de até
  15 minutos e não aceita miniatura própria. O vídeo sobe mesmo assim; a miniatura é ignorada, com aviso.
- **Limite do próprio canal:** o YouTube também limita quantos vídeos um canal envia por dia (por qualquer meio). O
  envio falha com o aviso e **Tentar de novo** no dia seguinte resolve.
- **Recusas depois do envio:** vídeo repetido, longo demais para o canal ou arquivo que o YouTube não lê. O hub confere
  nas horas seguintes ao envio e marca como **Falhou**, com o motivo.

## Para quem mexe no código

- `features/youtube/`: contrato, tabelas (`youtube_conta`, `youtube_pedidos_login`, `youtube_envios`), serviços
  (`conta.ts`: login e tokens; `subir.ts`: envio em pedaços, miniatura, conferência; `envios.ts`: pedidos e fila) e
  telas (card de Integrações, botão e janela do envio, lista de envios).
- Rotas: `/api/integracoes/youtube/{login,callback,status}` (chave Integrações) e `/api/youtube/{estado,envios}`
  (chave Enviar vídeos ao YouTube).
- A fila roda a cada minuto (`instrumentation.ts`, ao subir o servidor) e a cada pedido. O envio guarda a sessão de
  envio do Google (cifrada): se o servidor reiniciar no meio, continua de onde parou, sem vídeo repetido no canal.
- Precisa do banco (como o Drive). No PC sem banco, o card diz que é só na nuvem.
