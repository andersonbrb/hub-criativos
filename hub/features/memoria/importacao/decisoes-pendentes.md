# Decisões pendentes: regras do Sávio x regras atuais do Hub

> Até decidir, as ferramentas do Hub seguem como estão; o Sávio decide cada item e a regra vencedora vai para o documento certo.

## Contexto de uso

Quando o contexto do Sávio entrou na Memória do Hub, apareceram 18 pontos em que as regras dele e as regras que as ferramentas do Hub seguem hoje não batem. Cada item abaixo mostra os dois lados. Nenhum foi decidido ainda.

### 1. Modelo de voz
- **Sávio:** `eleven_multilingual_v2`, velocidade até 1.1x, clonar o narrador, e clone + STS para ter voz única.
- **Hub hoje:** `eleven_v4` com audio tags, sem clone e sem STS.
- **Decisão:** (pendente)

### 2. Fonte do tempo da legenda
- **Sávio:** o tempo vem do roteiro, por alinhamento forçado. Nunca Whisper no vídeo montado (já deslizou até 0,7 s).
- **Hub hoje:** transcreve o vídeo montado (Scribe).
- **Decisão:** (pendente)

### 3. Estilo da legenda
- **Sávio:** `drop` em Poppins Bold ~107 px em y=1060, com 1 palavra amarela por bloco; `sb` em Anton ~116 px em y=1480 + faixa no topo.
- **Hub hoje:** Montserrat 96 embaixo, destaque verde #22FF66. O playbook COD fala em texto branco com contorno vermelho + emoji (CapCut).
- **Decisão:** (pendente)

### 4. Música
- **Sávio:** −32 LUFS sob a fala, ducking de 11 dB.
- **Hub hoje:** volume fixo de 0,18.
- O final em −14 LUFS é igual nos dois.
- **Decisão:** (pendente)

### 5. Saída
- **Sávio:** 720×1280 para fonte baixa e 1080 só com fonte ≥720p ou vencedor; até 30 MB; AAC 128k com faststart; formatos 4:5 e 1:1.
- **Hub hoje:** sempre 1080×1920 9:16, sem limite de tamanho, AAC 192k.
- **Decisão:** (pendente)

### 6. Confirmações e custo
- **Sávio:** só pergunta em gasto real ou ação destrutiva; orçamento sempre com custo + tempo + opção paga mais rápida; piloto só para método novo ou caro.
- **Hub hoje:** confirma mais de 4 vídeos, Seedance 2.5 e o que ele mesmo propõe. O playbook infoproduto exige aprovação do Darlan antes do vídeo.
- **Decisão:** (pendente)

### 7. Fala em takes de IA
- **Sávio:** até 20 palavras por 8 s e gancho visual antes da fala.
- **Hub hoje (COD):** 12–15 palavras em 5 s e 20–25 em 8 s, fala desde o primeiro quadro.
- **Decisão:** (pendente)

### 8. Texto de aviso
- **Sávio:** "Solo con fines demostrativos. Algunas escenas están aceleradas."
- **Hub hoje (COD):** outro texto.
- **Decisão:** (pendente)

### 9. Preço e botão falso no vídeo
- **Sávio:** na maioria dos lotes, sem preço no vídeo e sem botão falso.
- **Hub hoje:** tem gráficos opcionais de preço e de CTA.
- **Decisão:** (pendente)

### 10. Efeitos sonoros
- **Sávio:** o lote Yara validado usa whoosh, punch-in e sticker.
- **Hub hoje:** nunca nas transições.
- **Decisão:** (pendente)

### 11. Ritmo
- **Sávio:** troca de plano a cada 1,1–4 s, corte do avatar na fronteira da palavra, silêncio cortado em 0,35 s deixando 0,12 s.
- **Hub hoje:** b-roll a cada 6–7 s ou na deixa, silêncio mínimo de 0,5 s.
- **Decisão:** (pendente)

### 12. Lipsync
- **Sávio:** nunca o modo `precision`; lipsync por trecho em vez de tradução literal inteira.
- **Hub hoje:** expõe o modo `precision`.
- **Decisão:** (pendente)

### 13. Crianças
- **Sávio:** ideia de persona "avó com neta" no lote Medalla (infoproduto).
- **Hub hoje (COD):** proíbe crianças.
- **Decisão:** (pendente)

### 14. Nomes de arquivo
- **Sávio:** `AD NN - <OFERTA>-<FORMATO>-<VOZ/IDIOMA>-<VARIAÇÃO>` e `VAR NN - G x AD`.
- **Hub hoje (COD):** `[PRODUTO]-H##-…`.
- **Decisão:** (pendente)

### 15. Quem aprova
- **Sávio:** só pede aprovação para gasto real, ação destrutiva ou piloto de método novo ou caro; não nomeia quem aprova.
- **Hub hoje:** os playbooks citam "Savin" e exigem aprovação do "Darlan".
- Falta definir quem aprova o quê.
- **Decisão:** (pendente)

### 16. Contexto antigo do Hub
- **Sávio:** os arquivos 01–03 e os projetos, com a situação de 13/10/2026.
- **Hub hoje:** o retrato de 06/10 (Lymphoria, Podadora, Wyze) no playbook de contexto, já substituído. O playbook COD aponta para pastas locais "Produtividade com ia".
- **Decisão:** (pendente)

### 17. Transcrição
- **Sávio:** faster-whisper local e grátis, em fila única com o OCR.
- **Hub hoje:** Scribe pago por padrão.
- **Decisão:** (pendente)

### 18. Inconsistências internas do Sávio
- **Sávio:** o próprio contexto se contradiz em quatro pontos:
  - Real-ESRGAN: ≈3× ou ≈1,5× da duração?
  - Música a −29 ou −32 LUFS no `audio.py`?
  - `--residual` ou `--idioma-residual`?
  - CTA em francês: "Touche" ou "Appuie"?
- **Hub hoje:** não se aplica.
- **Decisão:** (pendente)

## Lógica de uso

1. O Sávio decide um item por vez e escreve a decisão no lugar de "(pendente)", com a data.
2. A regra vencedora vai para o documento certo da Memória (regras, fluxo ou playbook) e, se for regra do Hub, para a ferramenta.
3. Quando todos os itens estiverem decididos, marque este documento como revisado.

## Relacionados
- [Preferências de trabalho](/memoria/03-preferencias-de-trabalho)
- [Voz e dublagem](/memoria/08-voz-e-dublagem)
- [Lições de produção](/memoria/22-licoes-producao-video)
