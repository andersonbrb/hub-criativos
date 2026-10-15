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

// ---------------------------------------------------------------------------------------------------------------
// Acréscimos da Onda 1 (Acesso). Tudo aqui continua puro: o proxy e as telas importam este arquivo.

export const PAPEIS: Papel[] = ["dono", "admin", "membro"];
export const ROTULO_DO_PAPEL: Record<Papel, string> = { dono: "Dono", admin: "Admin", membro: "Membro" };

export const rotuloDaChave = (chave: string) => CHAVES.find((c) => c.chave === chave)?.rotulo ?? chave;

// Chaves que a pessoa usa de fato (admin e dono: o catálogo inteiro). É o que a sidebar e o /api/acesso/eu mostram.
export const chavesLiberadas = (u: Usuario): Chave[] => (u.ativo ? (ehAdmin(u) ? [...TODAS_AS_CHAVES] : u.chaves) : []);

// "Marcar tudo" do convite e da edição: deixa de fora as restritas (administração e gasto), que só se ligam uma a uma.
export const CHAVES_SEM_RESTRITAS: Chave[] = CHAVES.filter((c) => !("restrita" in c && c.restrita)).map((c) => c.chave);

export const GRUPOS_DE_CHAVES = [...new Set(CHAVES.map((c) => c.grupo))].map((grupo) => ({
  grupo,
  chaves: CHAVES.filter((c) => c.grupo === grupo),
}));

// Cookie da sessão do site. O valor é aleatório; no banco fica só o SHA-256 dele.
export const COOKIE_SESSAO = "hub_sessao";
export const DURACAO_DA_SESSAO_SEGUNDOS = 60 * 60 * 24 * 30;

// O proxy repassa o caminho pedido (com a query) neste header, para exigirPagina() saber para onde voltar.
export const CABECALHO_CAMINHO = "x-hub-caminho";

export const SENHA_MINIMA = 10;

// Só aceita voltar para um caminho do próprio hub. "//x" e "/\x" o navegador trata como outro site.
export function caminhoSeguro(proximo: unknown, padrao = "/"): string {
  if (typeof proximo !== "string" || proximo.length > 2000) return padrao;
  if (!/^\/(?![/\\])/.test(proximo) || /[\u0000-\u001f\\]/.test(proximo)) return padrao;
  return proximo;
}

// Texto do Set-Cookie da sessão. Valor vazio com maxAge 0 apaga o cookie.
export function cabecalhoDoCookie(valor: string, opcoes: { seguro: boolean; maxAge?: number }) {
  const maxAge = opcoes.maxAge ?? DURACAO_DA_SESSAO_SEGUNDOS;
  return `${COOKIE_SESSAO}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${opcoes.seguro ? "; Secure" : ""}`;
}

// Atrás do proxy do Railway o Node recebe http; o protocolo real vem no x-forwarded-proto.
export const pedidoSeguro = (url: string, cabecalhos: Headers) =>
  (cabecalhos.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https" || url.startsWith("https:");

// Telas do menu e a chave de cada uma, na ordem em que a pessoa deve cair quando não tem a primeira.
export const TELAS: { href: string; chave: Chave }[] = [
  { href: "/", chave: "fluxo" },
  { href: "/chat", chave: "chat" },
  { href: "/criativo-automatico", chave: "criativo-automatico" },
  { href: "/biblioteca", chave: "biblioteca" },
  { href: "/editor", chave: "editor" },
  { href: "/estudios/geracao", chave: "estudios" },
  { href: "/memoria", chave: "memoria" },
  { href: "/conector", chave: "conector_claude" },
  { href: "/integracoes", chave: "integracoes" },
  { href: "/membros", chave: "membros" },
];

// Primeira tela que a pessoa pode abrir (null: nenhuma, a conta está sem chaves).
export const telaInicial = (u: Usuario): string | null => TELAS.find((t) => podeUsar(u, t.chave))?.href ?? null;

// Formatos que a API de acesso devolve (datas em texto ISO, como chegam no JSON).
export type Membro = Usuario & {
  criadoEm: string;
  ultimoAcessoEm: string | null;
  // false enquanto a pessoa não definiu senha (não consegue entrar).
  temSenha: boolean;
};

export type ConvitePendente = {
  id: string;
  email: string;
  nome: string | null;
  papel: Exclude<Papel, "dono">;
  chaves: Chave[];
  criadoEm: string;
  expiraEm: string;
  vencido: boolean;
  criadoPor: string | null;
};

// O que a tela de aceitar convite mostra antes de a pessoa criar a conta.
export type ConviteParaAceitar = { email: string; nome: string | null; papel: Exclude<Papel, "dono">; expiraEm: string };
