import "server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { convites, usuarios } from "@/db/schema";
import { limparChaves, type ConvitePendente, type ConviteParaAceitar, type Papel, type Usuario } from "@/features/acesso/contrato";
import { ConviteInvalido, RegraDeMembros, SoQuemPode } from "@/features/acesso/erros";
import { exigirGestor, ehUuid } from "@/features/acesso/servicos/membros";
import { gerarHashDeSenha, validarSenha } from "@/features/acesso/servicos/senha";
import { criarSessao, hashDoToken, novoToken, type MetaDaSessao } from "@/features/acesso/servicos/sessoes";
import { normalizarEmail, normalizarNome, paraUsuario } from "@/features/acesso/servicos/usuarios";
import { InputError } from "@/lib/server/http";

// Convites: o admin gera um link de uso único, válido por 7 dias, e manda para a pessoa por fora (WhatsApp, e-mail).
// O hub não envia e-mail. No banco fica só o SHA-256 do token, então o link aparece uma vez só, na hora de criar.

const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

type PapelDoConvite = Exclude<Papel, "dono">;

export type EntradaDoConvite = { email: unknown; nome?: unknown; papel?: unknown; chaves?: unknown };

export async function criarConvite(entrada: EntradaDoConvite, quemConvida: Usuario): Promise<{ link: string; convite: ConvitePendente }> {
  const eu = await exigirGestor(quemConvida);
  const email = normalizarEmail(entrada.email);
  if (!email) throw new InputError("Informe um e-mail válido.");
  const papel = entrada.papel ?? "membro";
  if (papel === "dono") throw new RegraDeMembros("O papel de dono só é dado pelo script do servidor (criar-dono).");
  if (papel !== "admin" && papel !== "membro") throw new InputError("Papel inválido: use admin ou membro.");
  // Convidar como admin é criar um admin.
  if (papel === "admin" && eu.papel !== "dono") throw new SoQuemPode("Só o dono do hub convida alguém como admin.");
  const nome = entrada.nome === undefined || entrada.nome === null || entrada.nome === "" ? null : normalizarNome(entrada.nome);
  if (entrada.nome && !nome) throw new InputError("O nome pode ter até 100 caracteres.");

  const [conta] = await banco().select({ ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
  if (conta?.ativo) throw new RegraDeMembros(`Já existe uma conta ativa com o e-mail ${email}. Para mudar o acesso dela, edite na lista de membros.`);

  // Um convite vivo por e-mail: o link novo substitui os anteriores ainda não usados.
  await banco().delete(convites).where(and(eq(convites.email, email), isNull(convites.usadoEm)));

  const token = novoToken();
  const [linha] = await banco()
    .insert(convites)
    .values({
      email,
      nome,
      papel: papel as PapelDoConvite,
      chaves: limparChaves(entrada.chaves),
      tokenHash: hashDoToken(token),
      criadoPor: eu.id,
      expiraEm: new Date(Date.now() + VALIDADE_MS),
    })
    .returning();

  return {
    link: `/aceitar-convite/${token}`,
    convite: { ...paraPendente(linha), criadoPor: eu.nome },
  };
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

// Convites ainda não usados, os vencidos inclusive (aparecem marcados, para o admin revogar ou refazer).
export async function listarConvites(): Promise<ConvitePendente[]> {
  const linhas = await banco()
    .select({ convite: convites, quem: usuarios.nome })
    .from(convites)
    .leftJoin(usuarios, eq(usuarios.id, convites.criadoPor))
    .where(isNull(convites.usadoEm))
    .orderBy(desc(convites.criadoEm));
  const agora = new Date();
  return linhas.map((l) => ({ ...paraPendente(l.convite, agora), criadoPor: l.quem }));
}

export async function revogarConvite(id: string, quemRevoga: Usuario) {
  await exigirGestor(quemRevoga);
  const apagados = ehUuid(id) ? await banco().delete(convites).where(and(eq(convites.id, id), isNull(convites.usadoEm))).returning({ id: convites.id }) : [];
  if (!apagados.length) throw new InputError("Esse convite não existe mais (já foi usado ou revogado). Recarregue a página.");
}

// Motivo de um convite não servir, com o texto que a pessoa convidada vai ler.
async function motivoDoConvite(token: string, agora = new Date()) {
  const [convite] = await banco().select().from(convites).where(eq(convites.tokenHash, hashDoToken(token))).limit(1);
  if (!convite) return { convite: null, erro: "Este convite não existe ou foi revogado. Peça um link novo a quem convidou você." };
  if (convite.usadoEm) return { convite, erro: "Este convite já foi usado. Se a conta é sua, entre com o seu e-mail e senha." };
  if (convite.expiraEm <= agora) return { convite, erro: "Este convite venceu (vale 7 dias). Peça um link novo a quem convidou você." };
  const [conta] = await banco().select({ ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.email, convite.email)).limit(1);
  if (conta?.ativo) return { convite, erro: `Já existe uma conta ativa com o e-mail ${convite.email}. Entre com ela.` };
  return { convite, erro: null };
}

const tokenValido = (token: unknown): token is string => typeof token === "string" && /^[\w-]{20,100}$/.test(token);

export async function buscarConvite(token: string): Promise<ConviteParaAceitar> {
  if (!tokenValido(token)) throw new ConviteInvalido("Link de convite inválido. Confira se copiou o endereço inteiro.");
  const { convite, erro } = await motivoDoConvite(token);
  if (erro || !convite) throw new ConviteInvalido(erro ?? "Convite inválido.");
  return { email: convite.email, nome: convite.nome, papel: convite.papel, expiraEm: convite.expiraEm.toISOString() };
}

// Cria a conta (ou reativa uma desativada com o mesmo e-mail), queima o convite e já abre a sessão.
export async function aceitarConvite(token: string, dados: { nome?: unknown; senha?: unknown }, meta: MetaDaSessao = {}) {
  if (!tokenValido(token)) throw new ConviteInvalido("Link de convite inválido. Confira se copiou o endereço inteiro.");
  const senha = validarSenha(dados.senha);
  const senhaHash = await gerarHashDeSenha(senha);
  const nomeDigitado = normalizarNome(dados.nome);

  const usuario = await banco().transaction(async (tx) => {
    const agora = new Date();
    // Marca como usado só se ainda estava livre e no prazo: dois cliques ao mesmo tempo não criam duas contas.
    const [convite] = await tx
      .update(convites)
      .set({ usadoEm: agora })
      .where(and(eq(convites.tokenHash, hashDoToken(token)), isNull(convites.usadoEm), gt(convites.expiraEm, agora)))
      .returning();
    // O motivo é lido depois da transação: dentro dela a conexão está presa.
    if (!convite) return null;

    const nome = nomeDigitado ?? convite.nome;
    if (!nome) throw new InputError("Informe o seu nome.");

    const [conta] = await tx.select().from(usuarios).where(eq(usuarios.email, convite.email)).limit(1).for("update");
    if (conta?.ativo) throw new ConviteInvalido(`Já existe uma conta ativa com o e-mail ${convite.email}. Entre com ela.`);

    const dadosDaConta = { nome, senhaHash, papel: convite.papel, chaves: limparChaves(convite.chaves), ativo: true };
    const [linha] = conta
      ? await tx.update(usuarios).set(dadosDaConta).where(eq(usuarios.id, conta.id)).returning()
      : await tx.insert(usuarios).values({ email: convite.email, ...dadosDaConta }).returning();
    return paraUsuario(linha);
  });
  if (!usuario) throw new ConviteInvalido((await motivoDoConvite(token)).erro ?? "Este convite não vale mais. Peça um link novo.");

  const sessao = await criarSessao(usuario.id, meta);
  return { usuario, token: sessao.token, expiraEm: sessao.expiraEm };
}
