> Vale para as duas operações (infoproduto e dropshipping COD). Base de referência, não regra final.

# Variações de um criativo validado

Quando o usuário sobe um criativo que já performa e pede copies, roteiros, ganchos (falados, em imagem ou em vídeo) ou variações, o trabalho é: entender por que ele funciona, variar sem quebrar o que valida e entregar o passo a passo de produção pelo caminho mais barato.

## 1. Ler o criativo (uma vez só)

1. `hub_view_video` com o id do anexo (8 quadros bastam para até 30s; mais só se tiver muitos cortes). Se já houver decupagem salva, parta dela e não assista de novo.
2. Monte a decupagem em tabela:

| Tempo | Visual (cena, enquadramento, quem aparece) | Fala | Texto na tela | Função |
|---|---|---|---|---|

   Função de cada trecho: gancho, problema, agitação, mecanismo, demonstração, prova, oferta ou CTA. Marque o que é b-roll e o que é a pessoa falando.
3. Salve com `hub_save_analysis`. Daqui para frente, todos os agentes leem dela.

## 2. Diagnóstico: por que funciona

Em poucas linhas:
- **Mecanismo do gancho** (o que prende nos primeiros 3s: pergunta, choque, duelo, resultado, identificação…).
- **Ângulo e avatar** (para quem fala e qual dor ou desejo ativa).
- **Formato** (UGC selfie, avatar, demonstração, antes/depois, depoimento, POV).
- **Ritmo** (cortes por minuto, duração, quando entra o produto e quando entra o CTA).
- **Idioma e tom** da fala.

O que for a razão de validar é a **base fixa**: não muda nas variações de contenção.

## 3. Variações

Regra 70/30: 70% contenção (mesma base, uma variável por vez) e 30% exploração (uma variável nova). Diga em cada linha qual variável mudou.

Entregue o que o usuário pedir, em tabela com código:
- **Ganchos falados**: 5 a 10, até 3s, no idioma do mercado, falados desde o primeiro frame.
- **Ganchos visuais** (imagem ou vídeo de abertura): a cena em uma linha, o texto na tela à parte e se dá para reaproveitar um b-roll que já existe.
- **Copies** (body e CTA) e **roteiros completos** com tempo por trecho, marcando onde entra cada b-roll.
- **Ad text** (texto do anúncio), quando fizer sentido.

Aponte as suas 2 ou 3 apostas e o porquê.

## 4. Passo a passo de produção

Para as variações aprovadas, monte o plano por etapa, do mais barato para o mais caro, com o custo estimado de cada uma:

1. **Reaproveitar do original**: trechos que entram iguais (o corpo validado, a demonstração, o CTA). Corte no editor do hub, sem custo.
2. **Voz**: o que precisa de narração nova (ElevenLabs); o que reaproveita o áudio original.
3. **Avatar ou pessoa falando**: HeyGen só se a variação exigir uma fala nova com rosto.
4. **B-rolls por cena**: primeiro os que já existem (busca no hub, `flora_project_media`, `hub_contact_sheet`); depois a lista do que falta gerar no FLORA, com o modelo (o mais barato que resolve) e o custo. Cena só de prompt vai direto em vídeo (sem frame); frame antes do vídeo só quando a cena precisa de imagem base de referência (produto real, mesma pessoa, lugar ou marca específicos).
5. **Montagem e legenda**: `hub_montage` ou o editor do hub (local, sem custo).
6. **Total estimado** da leva e o que depende de aprovação.

Peça aprovação do plano antes de gastar. Com o plano aprovado, registre no quadro do Fluxo (`pipeline_save_card`): um card por variação, com o roteiro e as gerações vinculadas.

## 5. Passar a vez

Cada etapa pode ir para o agente especialista (Copy, Voz, Avatar UGC, B-rolls, Estáticos). Ele lê esta conversa (`hub_read_chat`) e a decupagem salva, sem o usuário repetir nada.
