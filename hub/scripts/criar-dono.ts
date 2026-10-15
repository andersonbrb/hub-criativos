// Cria (ou recupera) a conta de dono do hub, com uma senha nova e forte impressa uma única vez.
// Uso: npm run criar-dono -- --email voce@exemplo.com --nome "Seu Nome"
// Usa a DATABASE_URL do ambiente (no Railway: `railway run npm run criar-dono -- ...`).
// Rodar de novo para o mesmo e-mail troca a senha e derruba as sessões abertas dessa conta.

import { garantirDono } from "@/features/acesso/servicos/donos";

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return undefined;
  const valor = process.argv[i + 1];
  return valor && !valor.startsWith("--") ? valor : undefined;
}

async function principal() {
  // No PC a DATABASE_URL costuma estar no hub/.env.local, que só o Next lê sozinho.
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env.local");
    } catch {}
  }
  const email = argumento("email");
  const nome = argumento("nome");
  if (!email) {
    console.error('Faltou o e-mail. Uso: npm run criar-dono -- --email voce@exemplo.com --nome "Seu Nome"');
    return 1;
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Falta a variável DATABASE_URL (endereço do Postgres). No PC, coloque no hub/.env.local ou rode pelo `railway run`.");
    return 1;
  }

  const { usuario, senha, criado } = await garantirDono({ email, nome });
  console.log("");
  console.log(criado ? "Conta de dono criada." : "Conta atualizada: agora é dono ativo, com senha nova (as sessões antigas caíram).");
  console.log(`  Nome:   ${usuario.nome}`);
  console.log(`  E-mail: ${usuario.email}`);
  console.log(`  Senha:  ${senha}`);
  console.log("");
  console.log("Guarde esta senha agora (gerenciador de senhas). Ela não aparece de novo e não fica salva em lugar nenhum.");
  console.log("Perdeu? Rode este comando de novo para gerar outra.");
  return 0;
}

// A conexão do Postgres fica aberta no processo: sai explicitamente no fim, com sucesso ou erro.
principal()
  .then((codigo) => process.exit(codigo))
  .catch((err) => {
    console.error(`Não deu para criar o dono: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
