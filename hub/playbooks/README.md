# Playbooks das operações

Fluxos de produção de criativos de cada operação, do jeito que rodam dentro do hub. São a base dos prompts dos agentes do
hub. Edite aqui para mudar o comportamento.

**Como fazer vídeo segue só o contexto do Sávio** (decisão do Vinícius em 20/10/2026). O documento das decisões
(`features/memoria/importacao/decisoes-pendentes.md`, "decisoes-pendentes" na Memória) diz a regra que vale em cada
ponto em que o hub e o Sávio não batiam. Em conflito, vale o Sávio; os playbooks ficaram só com o que é próprio do hub
(como usar o FLORA, prompts que funcionaram, organização do canvas).

| Operação | Arquivo | Resumo |
|---|---|---|
| Infoproduto | [infoproduto-edicao-video.md](infoproduto-edicao-video.md) | Roteiro → narração ElevenLabs → avatar HeyGen (piloto quando é novo) → B-rolls no FLORA → edição final do hub no padrão do Sávio (legenda pelo roteiro, áudio medido, entrega até 30 MB) |
| Variações de criativo validado | [variacoes-criativo-validado.md](variacoes-criativo-validado.md) | Assistir o criativo (quadros + fala), decupar e salvar, diagnosticar por que funciona, variar (70/30) e montar o passo a passo de produção do mais barato ao mais caro, reaproveitando b-rolls |
| Dropshipping COD | [dropshipping-cod-criativos.md](dropshipping-cod-criativos.md) | Hooks por mecanismo (70/30), frames GPT Image a partir da foto do produto → aprovação → vídeo Seedance no FLORA; produto rígido, idioma travado, custos medidos, montagem no padrão do Sávio |

As versões antigas ficam em [historico/](historico/) (a pasta não entra no prompt). O retrato da operação de 06/10/2026
("Contexto Grupo Chegou") saiu: foi substituído pelos documentos 01 a 03 e pelos projetos do Sávio na Memória.

Novas operações entram como um arquivo novo aqui.
