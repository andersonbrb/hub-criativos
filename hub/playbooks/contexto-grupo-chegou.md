# Contexto do trabalho — Grupo Chegou (operações, lotes e regras)

> Contexto de fundo, atualizado em 06/10/2026, vindo do trabalho de produção em lote feito fora do hub (kit de edição local).
>
> **Como usar dentro do hub:** use para entender quem é a pessoa, as frentes, as ofertas e os produtos já trabalhados, e as regras
> de qualidade (não inventar dados, oferta, voz de terceiros etc.). Caminhos de pasta (`Downloads/...`, `kit-edicao-criativos/...`),
> scripts Python do kit, rclone e skills citados abaixo existem só na máquina do kit: no hub, use as ferramentas do hub
> (FLORA, HeyGen, ElevenLabs, edição final, editor). Ids do FLORA e do HeyGen abaixo podem ser reaproveitados.

## 1. Quem é a pessoa e o que ela faz
Gestora de tráfego pago e produtora de criativos do **Grupo Chegou**, com três frentes (nunca misturar regras, métricas ou linguagem entre elas):
- **Dropshipping COD** (pagamento na entrega) — Chile, Colômbia, México, Guatemala, Equador, Romênia.
- **Infoprodutos** (VSL + quiz + upsell) — Onda Tesla 2.0, Glúteos Brasileños, Oração de San Benito.
- **X1 After-Pay** — nutracêutico vendido 1-a-1 por WhatsApp no Brasil, público 50+.

O dia a dia é **produzir criativos de vídeo em lote** (adaptar, traduzir, variar).

## 2. Regras de trabalho
- **Nunca ler nem imprimir chaves.**
- **Só parar para confirmar** antes de gastar dinheiro real (API paga) ou fazer algo destrutivo. O resto, seguir direto. Nunca perguntar "quer que eu continue?".
- **Orçamento sempre com:** custo em US$ + tempo médio + opção paga mais rápida, lado a lado.
- **Processos longos:** mostrar progresso `[k/N]`, % e tempo restante.
- **Resolução:** origem 360p → entregar 720x1280 (upscale 2x). 1080 só para vencedores ou origem alta.
- **Nunca inventar** dados, especificações, preços, ofertas ou resultados. Na dúvida, "precisa de revisão manual".
- **Voz:**
  - Criativos de **marca própria** (ex.: Mayaverra → Lymphoria): clonar o narrador original no ElevenLabs está autorizado sempre; reutilizar clones existentes.
  - Criativos de **criadores de terceiros** (ex.: Wyze): **a pessoa escolhe por lote/vídeo**. Padrão (B1): não clonar, voz de catálogo, rosto refeito com avatar HeyGen próprio + takes sem rosto. Mesmo criador (B2): só quando a pessoa confirma que o criador autorizou uso de imagem e voz → clone da voz + lipsync no vídeo original, com a autorização registrada no relatório. Perguntar no estudo do lote.
- **Produção noturna** (a pessoa dorme): trabalhar sozinho, conferir se algo travou, corrigir e entregar relatório no fim.

## 3. Ferramentas e custos de referência
- FLORA: Kling O1 Edit ≈ US$ 0,706 por clipe.
- HeyGen: plano Pro, ~9.000 créditos premium que zeram todo dia 30; ~15 créditos por vídeo de ~50 s.
- Whisper local (small), demucs para separar voz, upscale 2x com Real-ESRGAN (GPU) no kit.

### Armadilhas que já custaram retrabalho
- Kling recusa clipe < 3 s (estender o último quadro em vez de cortar por número de frames).
- **Kling em personagem Pixar/3D troca o rosto** → trocar só a região do produto (rótulo) em vez de editar o quadro inteiro.
- Ao colar um take editado no tempo original, copiar só a faixa do produto/rótulo (0,62–0,90 da altura); conferir o rótulo com zoom 3x (a folha de contato não mostra).
- Juntar vídeos de origens diferentes (HeyGen + original) com cópia direta pode abrir buraco de áudio; reencodar.
- Whisper e OCR juntos disputam CPU (até 10× mais lento): rodar em sequência.
- Faixa sobre texto queimado precisa de opacidade ≥ 250/255.
- Em 720p com faixa no rodapé: selo em y≈1110, setas do CTA em y≈1490.
- Revisão com transcrição + folha de contato + zoom pega defeitos que a miniatura não mostra.

## 4. Lotes feitos (status em 06/10/2026)

### Lymphoria (marca própria; antes Mayaverra) — COD Chile/Guatemala/Equador
- Oferta: envío gratis · pagas al recibir · 90 días de garantía · **sem preço no vídeo**. Produto: 4 hierbas (galio, stillingia, trébol rojo, fresno espinoso), gotas bajo la lengua cada mañana, sabe a miel.
- Lote antigo: ADs entregues + 13 versões v2 corrigidas; os ADs v2 03, 09, 22, 13 e 01 ainda têm restos de rótulo dentro da faixa da legenda (um "v3" grátis resolve).
- Lote Drenagem: **55 criativos entregues** — 20 ADs (10 longos + 10 curtos: 01, 03, 04, 05, 18, 20, 21, 24, 25, 30), 5 UGC HeyGen, 30 variações (10 ganchos × corpos AD20/AD05/AD30). Custo real ~US$ 24,75. Textos de anúncio prontos.
- Referência FLORA (frasco neutro): Lymphoria = nó n59, projeto `prj_ns7cvmdqvtn37b53wfnywhr9q58fjte1`. Linfarele (Itália) = nó n6, projeto `prj_ns7f6r91ft66e7jpk9d8mrapph8fn291`.

### Podadora Inalámbrica Césped Ruedas — COD Chile
- 4 traduzidos EN→ES + 8 variações + 11 estáticos. Oferta: pago contra entrega, despacho gratis, 90 días de garantía.
- No Drive já estão os 12 vídeos; faltam as imagens 13–23 e o txt de textos.

### Wyze Solar Cam Pan 2K — LATAM (a pessoa vende a **Wyze original**, a marca pode aparecer)
- **16 ADs ES entregues** (vídeo 17 excluído). Custo ~US$ 2,40 + ~115 créditos HeyGen.
- Só especificações oficiais (wyze.com): 2K, 360°/70°, visão noturna a cor, refletor, sirene 105 dB, áudio 2 vias, IP65, 1 h de sol/dia, cabo 3 m, microSD, sem assinatura obrigatória.
- Rostos de criador (01, 06, 12, 14, 16) refeitos com o avatar HeyGen "WYZE Review Latino 35" (id `430f346689b68545f1adbea9f186bd83`).
- **Sem selo de oferta**: a oferta ainda não foi confirmada.

### TikTok EN (Tarte CC Serum + Sungboon Toner) — **adiado pela pessoa**. Não iniciar sem pedido.

## 5. Pendências abertas
1. **Wyze:** confirmar a oferta (COD / frete / garantia) → selo nos 16; AD 02 saiu com voz feminina (trocar por masculina se pedir); textos de anúncio se pedir.
2. **Lymphoria v3:** limpar restos de rótulo na faixa da legenda nos ADs v2 03, 09, 22, 13, 01.
3. **Drive:** subir só quando a pessoa pedir (ela prefere local).

## 6. Método de um lote novo
1. Separar os originais (nunca mexer neles) e indexar.
2. Estudo (transcrição + folhas de contato): o que não serve, classificação, orçamento (custo + tempo + opção rápida) e perguntas de bloqueio.
3. Após aprovação, produzir por vídeo; caso **marca própria** (adaptar marca) ou **outro idioma/mercado** (traduzir criativo).
4. Revisão: idioma certo, sem resto de idioma/marca antiga, sem palavras proibidas, legenda e rótulo conferidos.
5. Entrega: relatório (custo real × orçado, decisões, "para você olhar"), arquivos numerados e textos de anúncio.
