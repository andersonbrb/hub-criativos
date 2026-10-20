# Decisões: regras do Sávio x regras antigas do Hub (fechado em 20/10/2026)

> Decisão do Vinícius em 20/10/2026: "como fazer os vídeos vai ser só de acordo com o contexto do Sávio, apenas isso". Nos 18 pontos vale a regra do Sávio, inclusive onde ela contraria uma regra antiga do próprio Vinícius. As regras antigas do Hub saíram dos playbooks, do prompt dos agentes e das ferramentas; as versões antigas ficam no histórico de cada documento. Os 4 pontos que o contexto do Sávio não decide foram decididos pelo Vinícius no mesmo dia (seção "Decididos pelo Vinícius", no fim): nada mais está pendente.

## Contexto de uso

Quando o contexto do Sávio entrou na Memória do Hub, apareceram 18 pontos em que as regras dele e as regras que o Hub seguia não batiam. Em 20/10/2026 o Vinícius decidiu todos a favor do Sávio. Cada item abaixo diz a regra que vale, o que mudou no Hub para segui-la e a regra antiga que saiu.

Em qualquer conflito sobre como fazer vídeo (roteiro, voz, avatar, b-roll, edição, legenda, áudio, entrega, revisão), vale o contexto do Sávio: documentos 02, 03, 04, 05, 07, 08, 09, 10, 11, 12 e 22 da Memória. Os playbooks do Hub ficaram só com o que não bate de frente com ele (como usar o FLORA, prompts que funcionaram, organização do canvas).

### 1. Modelo de voz
- **Vale (Sávio):** `eleven_multilingual_v2`, velocidade até 1,1x (se não couber, enxugar o texto ou congelar um take). Marca própria: clonar a voz do narrador original. Criador de terceiros: voz de catálogo no sotaque do mercado, 1 voz por criador. Voz única por avatar: clone + speech-to-speech (STS). Uma voz por personagem.
- **No Hub:** a narração (chat, agente de Voz e estúdio de Voz) sai em `eleven_multilingual_v2` por padrão; as tags de emoção deixaram de ser regra. O Hub ainda não clona voz nem faz STS: quando o lote precisar, o agente avisa em vez de trocar por outra voz.
- **Saiu:** `eleven_v4` com audio tags obrigatórias.

### 2. Fonte do tempo da legenda
- **Vale (Sávio):** legenda pelo roteiro, com alinhamento forçado, desde a 1ª versão. Nunca Whisper no vídeo montado (já deslizou até 0,7 s e obrigou a remontar 21 vídeos).
- **No Hub:** a edição final (`hub_montage` e estúdio Edição) escreve a legenda com o texto do roteiro: o roteiro passado no pedido ou, sozinho, o texto da narração do Hub que gerou o avatar. O tempo de cada palavra vem da fala dos vídeos originais do avatar, antes dos cortes, nunca do vídeo montado. O alinhamento do Hub encaixa o texto do roteiro nos tempos das palavras ouvidas na fala original (não é o alinhamento CTC do kit). Sem roteiro, a legenda sai da transcrição da fala original, também antes dos cortes. No editor, a legenda automática vem da fala do vídeo de origem e o agente troca o texto pelo do roteiro.
- **Saiu:** transcrever o vídeo para legendar.

### 3. Estilo da legenda
- **Vale (Sávio):** grande, branca com contorno preto, 1 palavra-chave amarela por bloco, blocos de até 3 palavras/16 caracteres, "pop" de entrada. Estilo `drop`: Poppins Bold ~107 px, centro y=1060. Estilo `sb`: Anton ~116 px, centro y=1480 + faixa no topo. No 4:5, y=745; no 1:1, y=596. Nada cobre rosto ou boca; manchete fixa no meio = sem legenda ao mesmo tempo.
- **No Hub:** a edição final usa o `drop` por padrão e oferece o `sb` (a faixa de topo do `sb` ainda não existe no Hub). O texto na tela do COD segue as posições do kit (manchete no topo só durante o gancho).
- **Caixa da letra (decisão do Vinícius em 20/10/2026):** a legenda sai do jeito que foi falada, com maiúsculas e minúsculas normais, nunca toda em maiúsculas. A edição final e o editor do Hub não têm mais a opção de caixa alta.
- **Saiu:** Montserrat 96 embaixo com destaque verde; no playbook COD, texto branco com contorno vermelho + emoji (CapCut); a opção "legenda em maiúsculas".

### 4. Música
- **Vale (Sávio):** −32 LUFS sob a fala, ducking de 11 dB; voz a −15 LUFS; final entre −16 e −13 (alvo ~−14), true peak ≤ −1 dBTP. Música trend liberada pela pessoa (instrumental via demucs), sem repetir alerta de direitos; sempre uma versão sem música de reserva.
- **No Hub:** a edição final mede a música e a deixa a −32 LUFS sob a fala, 11 dB acima onde não há fala; voz a −15 LUFS; final a −14 LUFS com pico em −1,5 dBTP. O controle de volume da música saiu da tela.
- **Saiu:** volume fixo de 0,18.

### 5. Saída
- **Vale (Sávio):** H.264 high, yuv420p, 30 fps, AAC 48 kHz estéreo 128k, +faststart, até 30 MB (vídeo longo que não cabe com qualidade sai acima do limite e isso é anotado; piso de 900 kbps). Origem 360p/480p → 720×1280; 1080×1920 só com origem ≥720p ou AD vencedor refeito. Formatos 9:16 (padrão), 4:5 e 1:1.
- **No Hub:** a edição final sai nesse padrão: resolução automática pela origem do vídeo do avatar (lado menor abaixo de 720 px → 720 de largura; senão 1080), com opção de pedir 720 ou 1080; formatos 9:16, 4:5 e 1:1; cabe em 30 MB (se não couber sem descer de 900 kbps, sai maior e o registro avisa). Exportação do editor e edição na batida: AAC 128k com faststart (a batida também até 30 MB e 30 fps). O Hub não faz upscale com IA: origem baixa é só redimensionada.
- **Saiu:** sempre 1080×1920 9:16, sem limite de tamanho, AAC 192k.

### 6. Confirmações e custo
- **Vale (Sávio):** só pedir confirmação para gasto real (API paga, mídia) ou ação destrutiva; o resto segue sem perguntar e nunca "quer que eu continue?". Sempre perguntam: compliance (manter × suavizar), criador terceiro (B1 × B2), oferta/preço fora de fonte. Todo orçamento: custo em US$ + tempo médio + opção paga mais rápida, pelo preço cobrado. Piloto só para método novo ou caro (lipsync, avatar, tradução com rosto); método validado e barato, tudo em paralelo; depois do aprovado, nada de aprovação vídeo a vídeo. Checklist de abertura numa mensagem só.
- **No Hub:** o prompt dos agentes segue essa regra.
- **Saiu:** confirmar mais de 4 vídeos, Seedance 2.5 e o que o agente propõe; a aprovação do Darlan antes do vídeo (playbook de infoproduto).

### 7. Fala em takes de IA
- **Vale (Sávio):** até ~20 palavras a cada 8 s; gancho visual antes da fala (título grande, elementos e som no quadro 1; movimento na primeira cena); transcrever cada take e cortar após a última palavra.
- **No Hub:** playbook COD, playbook de variações e agente de Copy com essa regra; o FLORA no modo COD deixou de pedir "fala contínua, sem silêncio".
- **Saiu:** 12–15 palavras em 5 s e 20–25 em 8 s, fala desde o primeiro quadro.

### 8. Texto de aviso
- **Vale (Sávio):** "Solo con fines demostrativos. Algunas escenas están aceleradas." numa faixa opaca no rodapé (alpha ≥250).
- **No Hub:** playbook COD com esse texto; a edição final ganhou o campo `aviso` (faixa opaca no rodapé).
- **Saiu:** "Solo demostración. Algunas imágenes están aceleradas. El rendimiento puede variar…".

### 9. Preço e botão falso no vídeo
- **Vale (Sávio):** falar preço ou não é decisão da pessoa por oferta (pergunta do checklist de abertura); na maioria dos lotes, sem preço no vídeo. CTA sem cara de botão: 2 setas vermelhas (~170 px) que entram na palavra do CTA e ficam até o fim; nenhum "botão falso"; o botão do Meta bate com o que o vídeo manda tocar.
- **No Hub:** o CTA da edição final virou as 2 setas vermelhas (campo `cta`, também quando o pedido usa o gráfico "cta"). O destaque de preço só entra se o usuário decidiu falar preço; contagem regressiva é compliance (perguntar).
- **Saiu:** o gráfico de CTA com botão + seta.

### 10. Efeitos sonoros
- **Vale (Sávio):** o lote Yara validado usa whoosh, punch-in e sticker (montador com macetes). Contraria a regra antiga do Vinícius ("nunca efeito sonoro nas transições"); agora vale a do Sávio.
- **No Hub:** a proibição saiu do prompt e das ferramentas; a edição final ganhou o whoosh opcional na entrada de cada b-roll; o punch-in é a troca de enquadramento nos cortes. Sticker o Hub ainda não tem.
- **Saiu:** "nunca efeito sonoro nas transições".

### 11. Ritmo
- **Vale (Sávio):** troca de plano a cada 1,1–4 s; cortar o avatar nas fronteiras das palavras (pausas viram b-roll ou jump cut com zoom 1,0/1,13; nunca segurar nem fundir quadros no rosto); silêncio acima de 0,35 s cortado deixando 0,12 s; zoom de montagem até ~1,2x; com avatar, b-roll de produto a cada ~10–15 s de avatar.
- **No Hub:** a edição final corta silêncio acima de 0,35 s deixando 0,12 s, alterna o enquadramento 1,00/1,13 a cada 1,1–4 s, deixa o b-roll de 2 a 4 s na tela e, sem deixa, põe o b-roll depois de ~10–15 s de avatar.
- **Saiu:** b-roll aos 6 s e a cada 7 s, silêncio mínimo de 0,5 s.

### 12. Lipsync
- **Vale (Sávio):** nunca o modo `precision` (a boca segue o idioma original nas pausas); `speed`, `enableDynamicDuration: false`, `keepTheSameFormat: true`, `fpsMode: cfr`; trechos de até ~12 s; lipsync por trecho em vez de tradução literal inteira (a tradução automática mantém preço e marca do original); preferir roteiro reescrito + narração nova; boca coberta → trocar só o áudio.
- **No Hub:** o modo "Precisão" sumiu do estúdio de Tradução e do chat (sempre `speed`, também em pedido antigo); com áudio próprio (lipsync), o HeyGen recebe duração dinâmica desligada, mesmo formato e quadros constantes. O Hub ainda não tem o lipsync por trecho com colagem só de boca e queixo.
- **Saiu:** a opção `precision`.

### 13. Crianças
- **Sávio:** só a ideia de persona "avó com neta" num lote de infoproduto (Medalla). O contexto dele não tem regra sobre crianças em vídeo COD.
- **Vale (decisão do Vinícius em 20/10/2026):** os vídeos de pagamento na entrega (COD) PODEM ter crianças. Não há proibição.
- **No Hub:** a proibição antiga (COD: "sem crianças em nenhum frame ou vídeo", e o "Adults only, no children anywhere" no prompt do FLORA) saiu e não volta.

### 14. Nomes de arquivo
- **Vale (Sávio):** `AD NN - <OFERTA>-<FORMATO>-<VOZ/IDIOMA>-<VARIAÇÃO>.mp4`; variações `VAR NN - <GANCHO> x <CORPO>`; nome do arquivo = nome do anúncio; no Meta, nome do conjunto = nome do anúncio = "AD NN"; cada oferta tem a sua sequência (listar os ADs da oferta e continuar do maior).
- **No Hub:** playbooks e edição final nesse padrão (o nome da edição aceita espaços e vira o nome do arquivo).
- **Saiu:** `[PRODUTO]-H##-…` e "confirme com o Savin o próximo número".

### 15. Quem aprova
- **Sávio:** só pede aprovação para gasto real, ação destrutiva ou piloto de método novo/caro; não diz quem aprova.
- **Vale (decisão do Vinícius em 20/10/2026):** quem gerou o lote de vídeos aprova o lote (gasto, piloto, avatar, roteiro), nas situações em que o Sávio pede aprovação. Não há outra pessoa a consultar.
- **No Hub:** saíram "Savin" e a aprovação do "Darlan" dos playbooks; o agente pede a aprovação a quem está gerando o lote (a pessoa que está usando o Hub ou o Claude Code).

### 16. Contexto antigo do Hub
- **Vale (Sávio):** documentos 01–03 e os projetos, com a situação de 13–14/10/2026.
- **No Hub:** o retrato de 06/10 (playbook "Contexto Grupo Chegou") saiu do prompt e ficou só como histórico; o playbook COD não aponta mais para as pastas locais "Produtividade com ia".

### 17. Transcrição
- **Vale (Sávio):** faster-whisper local e grátis (modelo small, CPU int8), em fila única com o OCR (nunca juntos); transcrever cada take antes de usar.
- **No Hub:** a transcrição (chat, agente de Transcrição, assistir vídeo, edição final e legenda do editor) é o Whisper local por padrão, um por vez; o ElevenLabs Scribe (pago) só entra se o Whisper falhar ou se pedirem.
- **Saiu:** Scribe por padrão.

### 18. Inconsistências internas do Sávio
- **Música −29 ou −32 LUFS:** vale −32. O próprio documento 08 diz que −32 é a regra da pessoa desde 09/10/2026 e que −29 é o padrão antigo do kit.
- **`--residual` ou `--idioma-residual`:** vale `--idioma-residual` (é o argumento real do script; `--residual` é erro da skill). Não afeta o Hub.
- **CTA em francês, "Touche" ou "Appuie":** vale "Appuie sur « En savoir plus »" (a v1 com "Touche" foi refeita; lição 11 do documento 22).
- **Real-ESRGAN, ≈3× ou ≈1,5× da duração:** o contexto não resolve sozinho (o teste do AD 03 deu ~1× no 2x e ~2× no 3x).
- **Vale (decisão do Vinícius em 20/10/2026):** nos orçamentos, o tempo de melhorar a qualidade (upscale) é **1,5× a duração do vídeo**, como o teste do próprio Sávio indicou. O Hub não faz upscale: a regra vale para o upscale feito no PC (kit do Sávio) e para os orçamentos dos agentes.

### Outros pontos em que o Hub contrariava o Sávio (achados na revisão de 20/10/2026)
- **Frame antes do vídeo:** o Hub mandava b-roll só de prompt direto em vídeo, sem frame. Vale o Sávio (documento 04): imagem base → aprovação → só então o vídeo. Prompt, agente de B-rolls, Criativo automático e playbook de variações seguem isso.
- **Alerta de direitos da música:** a edição na batida mandava avisar sobre direitos autorais. Vale o Sávio (documento 03): música trend liberada pela pessoa, sem repetir o alerta; só citar no fim quais músicas foram usadas.
- **Compliance no Criativo automático:** o modo "fazer tudo sozinho" não perguntava nada. Vale o Sávio: compliance (promessa de dinheiro ou cura, ameaça, contagem regressiva, famoso, depoimento com resultado) sempre pergunta manter × suavizar, mesmo nesse modo.
- **Custo:** o Hub mandava "o mínimo possível em toda tarefa". Vale o Sávio: orçamento com custo + tempo + a opção paga mais rápida, lado a lado (o reaproveitamento e as ferramentas grátis continuam vindo primeiro).

### Regras do Hub que o Sávio não tem e que ficaram (não batem de frente com ele)
Ficaram nos playbooks e nos agentes porque não contradizem o Sávio. Se alguma não deve valer, o Vinícius diz e ela sai:
- Variação de gancho na proporção 70/30 (contenção × exploração).
- Produto rígido no prompt de vídeo (só se move em linha reta).
- Seedance 2.0 Fast para explorar e 2.5 só para o que vai escalar; fal.ai em volume.
- Re-gancho a cada 6 a 10 s e "loop aberto" acima de 40 s (agente de Copy).
- Teto de ~US$ 1 a 2 de FLORA por criativo no Criativo automático.

## Decididos pelo Vinícius (20/10/2026)

O contexto do Sávio não decidia estes 4 pontos. O Vinícius decidiu, e eles valem como regra fechada:
1. **Crianças nos vídeos COD (item 13):** podem ter. Sem proibição.
2. **Quem aprova um lote de vídeos (item 15):** quem gerou o lote.
3. **Legenda (item 3):** do jeito que foi falada, com maiúsculas e minúsculas normais; nunca toda em maiúsculas.
4. **Tempo de upscale nos orçamentos (item 18):** 1,5× a duração do vídeo.

Não há mais ponto pendente.

## Lógica de uso

1. Como fazer vídeo: siga o contexto do Sávio e as 4 decisões acima. Em conflito com um playbook do Hub, com o prompt ou com a descrição de uma ferramenta, vale o Sávio (e, nos 4 pontos, a decisão do Vinícius).
2. Ponto novo que nem o Sávio nem esta lista decidem: pergunte ao usuário; não invente.
3. Quando o Vinícius decidir um ponto novo, escreva a decisão no item, com a data.

## Relacionados
- [Preferências de trabalho](/memoria/03-preferencias-de-trabalho)
- [Fluxo de produção de criativos](/memoria/04-fluxo-producao-criativos)
- [Voz e dublagem](/memoria/08-voz-e-dublagem)
- [Lipsync e avatar](/memoria/09-lipsync-e-avatar-heygen)
- [Revisão e qualidade](/memoria/11-revisao-e-qualidade)
- [Lições de produção](/memoria/22-licoes-producao-video)
