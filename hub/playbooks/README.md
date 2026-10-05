# Playbooks das operações

Regras e fluxos de produção de criativos de cada operação. São a base dos prompts dos agentes do hub
(quando os agentes forem ligados ao Claude, eles leem estes arquivos). Edite aqui para mudar o comportamento.

| Operação | Arquivo | Resumo |
|---|---|---|
| Infoproduto | [infoproduto-edicao-video.md](infoproduto-edicao-video.md) | Copy → avatar HeyGen (aprovação do Darlan) → B-rolls → pipeline de edição (jump cuts, Whisper, legendas ASS, B-roll overlay) no sandbox do Higgsfield |
| Variações de criativo validado | [variacoes-criativo-validado.md](variacoes-criativo-validado.md) | Assistir o criativo (quadros + fala), decupar e salvar, diagnosticar por que funciona, variar (70/30) e montar o passo a passo de produção do mais barato ao mais caro, reaproveitando b-rolls |
| Dropshipping COD | [dropshipping-cod-criativos.md](dropshipping-cod-criativos.md) | Hooks por mecanismo (70/30), frames GPT Image a partir da foto do produto → aprovação → vídeo Seedance no FLORA; regras de produto rígido, idioma travado, sem crianças, custos medidos |

São bases de referência, não regras finais. Novas operações entram como um arquivo novo aqui.
