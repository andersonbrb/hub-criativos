// Contrato do Acesso: o que as outras funcionalidades podem usar (tipos, catálogo de chaves, regras e erros).
// As funções que leem o banco ficam em features/acesso/servicos/sessao.ts.
// Mudou algo aqui? Avise quem usa: conector (features/conector), memória e o wrapper route() (lib/server/http.ts).

export type Papel = "dono" | "admin" | "membro";

// Catálogo das chaves por tela (como o PAGINAS_DISPONIVEIS do Chegou Operações).
// restrita: não entra no "marcar tudo" do convite (administração e gasto).
export const CHAVES = [
  { chave: "fluxo", rotulo: "Fluxo (quadro de tarefas)", grupo: "Produção" },
  { chave: "chat", rotulo: "Chat principal e agentes", grupo: "Produção" },
  { chave: "criativo-automatico", rotulo: "Criativo automático", grupo: "Produção" },
  { chave: "editor", rotulo: "Editor de vídeo", grupo: "Produção" },
  { chave: "biblioteca", rotulo: "Biblioteca", grupo: "Produção" },
  { chave: "estudios", rotulo: "Estúdios (gera no FLORA, ElevenLabs e HeyGen, gasta créditos)", grupo: "Estúdios" },
  { chave: "memoria", rotulo: "Memória (ler)", grupo: "Memória" },
  { chave: "memoria_editar", rotulo: "Memória (editar)", grupo: "Memória" },
  { chave: "conector_claude", rotulo: "Conector do Claude Code", grupo: "Memória" },
  { chave: "integracoes", rotulo: "Integrações (ligar e desligar contas)", grupo: "Administração", restrita: true },
  { chave: "membros", rotulo: "Membros e convites", grupo: "Administração", restrita: true },
] as const satisfies readonly { chave: string; rotulo: string; grupo: string; restrita?: boolean }[];

export type Chave = (typeof CHAVES)[number]["chave"];

export const TODAS_AS_CHAVES: Chave[] = CHAVES.map((c) => c.chave);

export const ehChave = (v: unknown): v is Chave => typeof v === "string" && (TODAS_AS_CHAVES as string[]).includes(v);

// Remove chaves desconhecidas ou repetidas (dado vindo de formulário ou do banco).
export const limparChaves = (v: unknown): Chave[] => (Array.isArray(v) ? [...new Set(v.filter(ehChave))] : []);

export type Usuario = {
  id: string;
  email: string;
  nome: string;
  papel: Papel;
  ativo: boolean;
  chaves: Chave[];
};

export const ehAdmin = (u: Pick<Usuario, "papel">) => u.papel === "dono" || u.papel === "admin";

// Fonte única da permissão: conta ativa e (admin/dono ou chave liberada).
export const podeUsar = (u: Usuario, chave: Chave) => u.ativo && (ehAdmin(u) || u.chaves.includes(chave));

// Sem sessão válida: 401 na API, ida para /entrar nas páginas.
export class NaoAutenticado extends Error {
  constructor(message = "Entre com a sua conta para continuar.") {
    super(message);
  }
}

// Logado, mas sem a chave da tela: 403.
export class SemPermissao extends Error {
  constructor(public chave?: Chave) {
    super(chave ? `Sua conta não tem acesso a "${CHAVES.find((c) => c.chave === chave)?.rotulo ?? chave}". Peça a um admin.` : "Sua conta não tem acesso a isso.");
  }
}
