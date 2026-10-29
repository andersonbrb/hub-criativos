# Arquivos compartilhados das skills

Esta pasta não é uma skill: guarda o que várias skills de Instagram usam em comum.

| Pasta         | Conteúdo                                                                                            | Usada por                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `references/` | Heurísticas do algoritmo, hashtags, fórmulas de gancho, voz, fluxo de mídia, conteúdo não confiável | `ig-*-writer`, `-planner`, `-extractor`, `ig-humanizer`, `ig-repurposer`, `instagram-marketing` |
| `templates/`  | Modelo `voice.md` (perfil de voz da marca). Copie para `~/.claude/instagram/voice.md`               | `ig-plan`, `ig-reel` e demais `ig-*` curtas                                                     |
| `lib/`        | Clientes Python opcionais (Publora, Apify, Pixfaro) e `requirements.txt`                            | `instagram-marketing` (publicação via Publora)                                                  |
| `licenses/`   | Licenças MIT dos dois pacotes de origem                                                             | —                                                                                               |

## Origem das skills

- `ig-audit`, `ig-caption`, `ig-carousel`, `ig-comment`, `ig-dm`, `ig-human`, `ig-plan`,
  `ig-profile`, `ig-reel`, `ig-reply`, `ig-repurpose`, `ig-story`, `ig-viral` —
  [Jakeschincariol/instagram-agent-skill](https://github.com/Jakeschincariol/instagram-agent-skill) (MIT).
- `instagram-marketing`, `ig-audience-insights`, `ig-caption-writer`, `ig-carousel-planner`,
  `ig-content-planner`, `ig-hashtag-strategist`, `ig-hook-extractor`, `ig-humanizer`,
  `ig-profile-optimizer`, `ig-repurposer` —
  [sergebulaev/instagram-skills](https://github.com/sergebulaev/instagram-skills) (MIT).

Os caminhos `../../references/` das skills originais foram ajustados para `../_shared/references/`.
As integrações externas citadas por algumas skills (Publora, Apify, Pixfaro) são opcionais e
exigem chaves próprias; a plataforma publica pelo próprio backend.
