// Contrato do Conector do Claude Code: tipos e textos que as telas usam. Arquivo puro (sem código de servidor).
// O servidor (OAuth, MCP e links) fica em features/conector/servicos.

export const APPS = { claude: "Claude", claude_code: "Claude Code" } as const;
export type App = keyof typeof APPS;

// Nome do conector no Claude Code de cada pessoa (o do comando "claude mcp add").
export const NOME_NO_CLAUDE_CODE = "hub-criativos";

export type PessoaNaTela = { nome: string; email: string };

// O que a tela de consentimento recebe do servidor.
export type PedidoNaTela =
  | {
      estado: "pronto";
      pedidoId: string;
      app: string;
      clienteNome: string;
      // Para onde o código volta: "claude.ai", "localhost:33418"…
      destinoHost: string;
      // Retorno no loopback: é o Claude Code no computador de quem está autorizando.
      destinoLocal: boolean;
      expiraEm: string;
      pessoa: PessoaNaTela;
    }
  | { estado: "vencido" | "usado" | "invalido"; mensagem: string };

export type ConexaoNaTela = {
  id: string;
  app: string;
  clienteNome: string;
  criadoEm: string;
  ultimoUsoEm: string | null;
  ip: string | null;
};

export const TEXTO_PEDIDO_VENCIDO = "Este pedido de conexão não existe ou venceu. Volte ao Claude e conecte de novo.";
export const TEXTO_PEDIDO_USADO = "Este pedido de conexão já foi respondido. Volte ao Claude e conecte de novo, se precisar.";
export const TEXTO_PEDIDO_INCOMPLETO = "Este link de conexão está incompleto. Volte ao Claude e tente conectar de novo.";

// `--scope user`: sem ele o Claude Code guarda o conector só para a pasta onde o comando foi colado, e aberto em
// outra pasta não enxerga o hub.
export function comandoClaudeCode(endereco: string) {
  return `claude mcp add --scope user --transport http ${NOME_NO_CLAUDE_CODE} ${endereco}`;
}

// Prompt pronto que o Sávio cola no Claude Code dele para trocar a pasta de contexto local pela memória do Hub.
// Quem executa é o Claude Code dele (que tem o disco e as ferramentas); o texto só diz o quê e em que ordem.
export const TEXTO_DE_MIGRACAO = `Quero que a memória do meu trabalho passe a morar no Hub de Criativos, pelo conector ${NOME_NO_CLAUDE_CODE}. Faça nesta ordem:

1. Chame a ferramenta "instrucoes" do conector ${NOME_NO_CLAUDE_CODE} e leia tudo (se vier em páginas, leia todas).

2. Procure neste computador os arquivos de memória que ainda não estão no Hub:
   - banco-de-copy.md, estrategias-criativos.md, VOZES-CLONADAS.md e LICOES-LIPSYNC.md;
   - o CLAUDE.md do kit de edição;
   - o meu CLAUDE.md global (~/.claude/CLAUDE.md);
   - as memórias do Claude Code (os arquivos feedback_*.md e project_*.md, em ~/.claude/projects/*/memory/);
   - se existirem, os briefings BRIEFING_COMPLETA.md e ESTUDO-CTA.md.
   Antes de subir qualquer coisa, me mostre a lista do que achou e onde.

3. Para cada arquivo, busque antes na memória do Hub (memoria_buscar e, se achar algo parecido, memoria_ler) para não duplicar. Se o assunto já existe, acrescente só o que falta com memoria_acrescentar, em vez de criar outro documento.

4. O que for novo, grave com memoria_salvar, escolhendo o tipo certo (regra, fluxo, fato, projeto, licao, decisao ou playbook) e a frente certa (cod, info, x1 ou geral). Antes de gravar, TIRE do texto qualquer chave, token ou senha (de API, de conta, de login). No lugar, escreva "[segredo removido: fica fora do Hub]". Fatos levam data absoluta (AAAA-MM-DD): quando o arquivo não disser a data de um fato, use a data da última alteração do arquivo e marque o documento como precisa de revisão. O que você não conseguir confirmar também vai marcado como precisa de revisão.

5. No meu CLAUDE.md local, troque as referências à pasta contexto-savio por esta frase: "A memória mora no Hub: use o conector ${NOME_NO_CLAUDE_CODE} (instrucoes, memoria_buscar, memoria_ler) antes de qualquer tarefa e registre lotes e lições ao terminar (projeto_registrar e licao_registrar)." Não apague a pasta contexto-savio: só pare de usá-la.

6. No fim, me mostre uma lista do que subiu (arquivo → documento no Hub), do que foi só acrescentado e do que ficou de fora, com o motivo.`;
