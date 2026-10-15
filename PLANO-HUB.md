# Plano do Hub: uma plataforma só (Hub de Criativos + contexto do Sávio)

Leia antes de mexer em qualquer coisa desta fase. Atualize as marcas ✅ ao terminar cada item.

## Objetivo
O "contexto do Sávio" (43 textos de regras, fluxos, dados do negócio, lotes e lições, repositório `contexto-savio`)
passa a morar dentro do Hub, e o repositório antigo deixa de ser usado. O Claude Code de cada pessoa continua
produzindo criativos no próprio PC (assinatura, sem API), lendo e gravando a memória pelo **Conector do Hub** (MCP com login).

## Organização do código (padrão novo, inspirado no chegou-operacoes)
- `hub/features/<nome>/`: uma pasta por funcionalidade.
  - `contrato.ts`: tipos, constantes e regras puras, sem código de servidor (a tela pode importar).
  - `erros.ts`: erros que viram 400/401/403/409.
  - `tabelas.ts`: tabelas Drizzle. **Só imports relativos**, porque o drizzle-kit não entende "@/".
  - `servicos/`: regra de negócio, com `import "server-only"`.
  - `tela/`: componentes React da funcionalidade.
  - `testes/*.test.ts`: vitest com Postgres em memória (`bancoDeTeste()` de `db/teste.ts`).
- Rotas em `app/` são finas: validam a entrada e chamam os serviços.
- `db/`: conexão (`cliente.ts`), `schema.ts` (reúne as tabelas) e `migrations/` (geradas, nunca escritas à mão).
- Código antigo em `lib/server/` continua onde está; vai sendo movido para `features/` aos poucos (Onda 3).
- Comentários, mensagens e nomes de domínio em português. O comentário explica o porquê.

## Regras para agentes trabalhando em paralelo
- Mexa **só** nas pastas da sua lista. Precisa de algo fora dela? Descreva no relatório final; quem junta faz.
- Não rode `npm install`, `git commit`, `git stash`, `git checkout`, `git reset` nem `npm run db:gerar`. A migração
  única é gerada na junção (Onda 2), para não haver conflito de numeração.
- Teste só o seu pedaço: `npx vitest run features/<nome>`. `npx tsc --noEmit` pode mostrar erro de outro agente em
  andamento; corrija só os seus.
- Não mude as assinaturas dos contratos (`features/*/contrato.ts`, `features/acesso/servicos/sessao.ts`,
  `features/memoria/servicos/memoria.ts`). Pode acrescentar.
- Conteúdo da memória (dados do negócio, IDs de contas, faturamento) **nunca** entra no git: só no banco.

## Ondas
### Onda 0: fundação ✅
Dependências (Drizzle, postgres, vitest, PGlite, tsx), `db/`, padrão `features/`, contratos de Acesso e Memória,
este plano, CHANGELOG.

### Onda 1: em paralelo
- **A, Acesso:** contas, senha, sessões, convites, chaves por tela, telas Entrar, Aceitar convite e Membros. Troca a
  senha única (`HUB_PASSWORD`) e cria o script `criar-dono`.
- **B, Memória:** base de conhecimento com versões, busca, barreira de segredo, importador do contexto do Sávio e
  dos playbooks, tela Memória e memória no chat interno.
- **C, Conector:** MCP público com OAuth 2.1 (porta do conector do chegou-operacoes), telas de consentimento e de
  conexões, e ferramentas de memória, biblioteca, links de envio e download, e Fluxo.
- **D, Infra:** projeto "Hub de Criativos" no Railway (Postgres, volume, variáveis, domínio), saúde, migração ao subir.

Critério de pronto de cada agente: os testes dele passam, sem erro de tipo nos arquivos dele, e relatório com o que
ficou de fora.

### Onda 2: junção e publicação
Migração única, lint, tipos, testes, build, revisão de segurança e de funcionamento, publicação no Railway,
conta do dono, importação da memória no banco de produção, convites e teste de ponta a ponta com o Claude Code.

### Onda 3 em diante
- Gerações, conversas, quadro, editor, decupagens e sessões das integrações no banco, com importação do hub antigo.
- Dono por item.
- Mídias em bucket e serviço separado para edição pesada.
- Gerar no FLORA, HeyGen e ElevenLabs pelo conector, com teto de gasto.
- Lotes ao vivo (substitui o painel local do Sávio).
- Ferramentas vindas do kit do Sávio: revisão automática, upscale, troca de marca, lipsync sobre vídeo, analisador
  de vencedores do Meta, base de cases.
- Resolver o documento "Decisões pendentes" da Memória: são 18 conflitos entre as regras do Sávio e as do Hub.
