import "server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { convites, organizacaoMembros, organizacoes, usuarios } from "@/db/schema";
import { limparChaves, type ConvitePendente, type ConviteParaAceitar, type Papel, type Usuario } from "@/features/acesso/contrato";
import { ConviteInvalido, CredenciaisInvalidas, RegraDeMembros, SoQuemPode } from "@/features/acesso/erros";
import { comVagaDeSenha, conferirCredenciais } from "@/features/acesso/servicos/login";
import { exigirGestor, ehUuid } from "@/features/acesso/servicos/membros";
import { gerarHashDeSenha, validarSenha } from "@/features/acesso/servicos/senha";
import { criarSessao, hashDoToken, novoToken, type MetaDaSessao } from "@/features/acesso/servicos/sessoes";
import { normalizarEmail, normalizarNome, usuarioNaOrganizacao } from "@/features/acesso/servicos/usuarios";
import { InputError } from "@/lib/server/http";

// Convites: um admin gera um link de uso único, válido por 7 dias, e manda para a pessoa por fora (WhatsApp, e-mail).
// O hub não envia e-mail. No banco fica só o SHA-256 do token, então o link aparece uma vez só, na hora de criar.
//
// O convite é para UMA organização. Quem ainda não tem conta cria nome e senha. Quem já tem (participa de outra
// organização) confirma com a senha de sempre: o link sozinho não dá a conta de ninguém a quem o encontrar.

const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

export type EntradaDoConvite = { email: unknown; nome?: unknown; papel?: unknown; chaves?: unknown };

const ehPapel = (v: unknown): v is Papel => v === "dono" || v === "admin" || v === "membro";

async function vinculoPeloEmail(organizacaoId: string, email: string) {
  const [linha] = await banco()
    .select({ ativo: organizacaoMembros.ativo })
    .from(organizacaoMembros)
    .innerJoin(usuarios, eq(usuarios.id, organizacaoMembros.usuarioId))
    .where(and(eq(organizacaoMembros.organizacaoId, organizacaoId), eq(usuarios.email, email)))
    .limit(1);
  return linha ?? null;
}

// Usado também pela tela Plataforma, ao criar uma organização com o primeiro dono (sem passar pelas regras da equipe).
export async function gravarConvite(dados: { organizacaoId: string; email: string; nome: string | null; papel: Papel; chaves: string[]; criadoPor: string | null }) {
  // Um convite vivo por e-mail e organização: o link novo substitui os anteriores ainda não usados.
  await banco()
    .delete(convites)
    .where(and(eq(convites.organizacaoId, dados.organizacaoId), eq(convites.email, dados.email), isNull(convites.usadoEm)));
  const token = novoToken();
  const [linha] = await banco()
    .insert(convites)
    .values({ ...dados, chaves: limparChaves(dados.chaves), tokenHash: hashDoToken(token), expiraEm: new Date(Date.now() + VALIDADE_MS) })
    .returning();
  return { link: `/aceitar-convite/${token}`, linha };
}

export async function criarConvite(entrada: EntradaDoConvite, quemConvida: Usuario): Promise<{ link: string; convite: ConvitePendente }> {
  const eu = await exigirGestor(quemConvida);
  const org = eu.organizacao;
  const email = normalizarEmail(entrada.email);
  if (!email) throw new InputError("Informe um e-mail válido.");
  const papel = entrada.papel ?? "membro";
  if (!ehPapel(papel)) throw new InputError("Papel inválido: use dono, admin ou membro.");
  // Convidar como admin ou dono é criar um admin ou dono.
  if (papel !== "membro" && eu.papel !== "dono") throw new SoQuemPode("Só um dono da organização convida alguém como admin ou dono.");
  const nome = entrada.nome === undefined || entrada.nome === null || entrada.nome === "" ? null : normalizarNome(entrada.nome);
  if (entrada.nome && !nome) throw new InputError("O nome pode ter até 100 caracteres.");

  const vinculo = await vinculoPeloEmail(org.id, email);
  if (vinculo?.ativo) throw new RegraDeMembros(`${email} já faz parte de ${org.nome}. Para mudar o acesso, edite na lista da equipe.`);
  if (vinculo) throw new RegraDeMembros(`${email} está desativado em ${org.nome}. Reative na lista da equipe em vez de convidar.`);

  const { link, linha } = await gravarConvite({ organizacaoId: org.id, email, nome, papel, chaves: papel === "membro" ? limparChaves(entrada.chaves) : [], criadoPor: eu.id });
  return { link, convite: { ...paraPendente(linha), criadoPor: eu.nome } };
}

const paraPendente = (l: typeof convites.$inferSelect, agora = new Date()): ConvitePendente => ({
  id: l.id,
  email: l.email,
  nome: l.nome,
  papel: l.papel,
  chaves: limparChaves(l.chaves),
  criadoEm: l.criadoEm.toISOString(),
  expiraEm: l.expiraEm.toISOString(),
  vencido: l.expiraEm <= agora,
  criadoPor: null,
});

// Convites da organização ainda não usados, os vencidos inclusive (aparecem marcados, para revogar ou refazer).
export async function listarConvites(organizacaoId: string): Promise<ConvitePendente[]> {
  const linhas = await banco()
    .select({ convite: convites, quem: usuarios.nome })
    .from(convites)
    .leftJoin(usuarios, eq(usuarios.id, convites.criadoPor))
    .where(and(eq(convites.organizacaoId, organizacaoId), isNull(convites.usadoEm)))
    .orderBy(desc(convites.criadoEm));
  const agora = new Date();
  return linhas.map((l) => ({ ...paraPendente(l.convite, agora), criadoPor: l.quem }));
}

export async function revogarConvite(id: string, quemRevoga: Usuario) {
  const eu = await exigirGestor(quemRevoga);
  const apagados = ehUuid(id)
    ? await banco()
        .delete(convites)
        .where(and(eq(convites.id, id), eq(convites.organizacaoId, eu.organizacao.id), isNull(convites.usadoEm)))
        .returning({ id: convites.id })
    : [];
  if (!apagados.length) throw new InputError("Esse convite não existe mais (já foi usado ou revogado). Recarregue a página.");
}

// Motivo de um convite não servir, com o texto que a pessoa convidada vai ler.
async function motivoDoConvite(token: string, agora = new Date()) {
  const [linha] = await banco()
    .select({ convite: convites, org: organizacoes })
    .from(convites)
    .innerJoin(organizacoes, eq(organizacoes.id, convites.organizacaoId))
    .where(eq(convites.tokenHash, hashDoToken(token)))
    .limit(1);
  if (!linha) return { linha: null, erro: "Este convite não existe ou foi revogado. Peça um link novo a quem convidou você." };
  const { convite, org } = linha;
  if (convite.usadoEm) return { linha, erro: "Este convite já foi usado. Se a conta é sua, entre com o seu e-mail e senha." };
  if (convite.expiraEm <= agora) return { linha, erro: "Este convite venceu (vale 7 dias). Peça um link novo a quem convidou você." };
  if (org.situacao !== "ativa") return { linha, erro: `A organização ${org.nome} está suspensa. Fale com quem convidou você.` };
  const vinculo = await vinculoPeloEmail(org.id, convite.email);
  if (vinculo) return { linha, erro: `${convite.email} já faz parte de ${org.nome}. Entre com a sua conta.` };
  return { linha, erro: null };
}

const tokenValido = (token: unknown): token is string => typeof token === "string" && /^[\w-]{20,100}$/.test(token);

async function contaPeloEmail(email: string) {
  const [conta] = await banco().select({ id: usuarios.id, temSenha: usuarios.senhaHash }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
  return conta ? { id: conta.id, temSenha: Boolean(conta.temSenha) } : null;
}

export async function buscarConvite(token: string): Promise<ConviteParaAceitar> {
  if (!tokenValido(token)) throw new ConviteInvalido("Link de convite inválido. Confira se copiou o endereço inteiro.");
  const { linha, erro } = await motivoDoConvite(token);
  if (erro || !linha) throw new ConviteInvalido(erro ?? "Convite inválido.");
  const conta = await contaPeloEmail(linha.convite.email);
  return {
    email: linha.convite.email,
    nome: linha.convite.nome,
    papel: linha.convite.papel,
    expiraEm: linha.convite.expiraEm.toISOString(),
    organizacao: linha.org.nome,
    contaExiste: Boolean(conta?.temSenha),
  };
}

// Aceita o convite: cria a conta (ou confirma a que já existe pela senha), entra na organização, queima o convite e
// já abre a sessão nela.
export async function aceitarConvite(token: string, dados: { nome?: unknown; senha?: unknown }, meta: MetaDaSessao = {}) {
  if (!tokenValido(token)) throw new ConviteInvalido("Link de convite inválido. Confira se copiou o endereço inteiro.");
  // Rota aberta: o convite (consulta barata) é conferido antes da senha (scrypt, caro), para um link inventado não
  // gastar CPU do servidor. A transação abaixo confere de novo, agora com a linha travada.
  const { linha, erro } = await motivoDoConvite(token);
  if (erro || !linha) throw new ConviteInvalido(erro ?? "Convite inválido.");

  const existente = await contaPeloEmail(linha.convite.email);
  let senhaHash: string | null = null;
  if (existente?.temSenha) {
    // Conta de outra organização: a pessoa prova que é dela com a senha de sempre (com o mesmo freio do login).
    try {
      await conferirCredenciais(linha.convite.email, dados.senha, meta);
    } catch (err) {
      if (err instanceof CredenciaisInvalidas) throw new ConviteInvalido("Senha incorreta. Use a senha que você já usa para entrar no hub.");
      throw err;
    }
  } else {
    const senha = validarSenha(dados.senha);
    senhaHash = await comVagaDeSenha(() => gerarHashDeSenha(senha));
  }
  const nomeDigitado = normalizarNome(dados.nome);

  const resultado = await banco().transaction(async (tx) => {
    const agora = new Date();
    // Marca como usado só se ainda estava livre e no prazo: dois cliques ao mesmo tempo não aceitam duas vezes.
    const [convite] = await tx
      .update(convites)
      .set({ usadoEm: agora })
      .where(and(eq(convites.tokenHash, hashDoToken(token)), isNull(convites.usadoEm), gt(convites.expiraEm, agora)))
      .returning();
    // O motivo é lido depois da transação: dentro dela a conexão está presa.
    if (!convite) return null;

    const [conta] = await tx.select().from(usuarios).where(eq(usuarios.email, convite.email)).limit(1).for("update");
    let usuarioId: string;
    if (conta?.senhaHash) {
      usuarioId = conta.id;
    } else {
      // Sem senha ainda: a pessoa define agora (a senha foi validada acima, antes da transação).
      if (!senhaHash) throw new ConviteInvalido("Defina uma senha para a sua conta.");
      const nome = nomeDigitado ?? convite.nome ?? conta?.nome;
      if (!nome) throw new InputError("Informe o seu nome.");
      const [linhaConta] = conta
        ? await tx.update(usuarios).set({ nome, senhaHash }).where(eq(usuarios.id, conta.id)).returning()
        : await tx.insert(usuarios).values({ email: convite.email, nome, senhaHash }).returning();
      usuarioId = linhaConta.id;
    }

    const novos = await tx
      .insert(organizacaoMembros)
      .values({ organizacaoId: convite.organizacaoId, usuarioId, papel: convite.papel, chaves: limparChaves(convite.chaves), ativo: true })
      .onConflictDoNothing()
      .returning({ id: organizacaoMembros.usuarioId });
    if (!novos.length) throw new ConviteInvalido(`${convite.email} já faz parte desta organização. Entre com a sua conta.`);
    return { usuarioId, organizacaoId: convite.organizacaoId };
  });
  if (!resultado) throw new ConviteInvalido((await motivoDoConvite(token)).erro ?? "Este convite não vale mais. Peça um link novo.");

  const sessao = await criarSessao(resultado.usuarioId, meta, resultado.organizacaoId);
  const usuario = (await usuarioNaOrganizacao(resultado.usuarioId, sessao.organizacaoId))!;
  return { usuario, token: sessao.token, expiraEm: sessao.expiraEm };
}
