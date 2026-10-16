// Leva o contexto do Sávio (repositório contexto-savio) e os playbooks do hub para a Memória, no banco do DATABASE_URL.
// Uso, de dentro de hub/:  npm run importar-memoria -- <pasta do contexto-savio> [--organizacao <id>]
// Sem --organizacao, a memória vai para a organização padrão (Grupo Chegou).
// Pode rodar de novo: o que já está igual é pulado e só texto novo vira versão nova ("reimportado").
import { existsSync } from "node:fs";
import path from "node:path";

import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { comOrganizacao, ehIdDeOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { importarMemoria } from "@/features/memoria/importacao/importar";

async function main() {
  const pasta = process.argv[2];
  if (!pasta) {
    console.error("Diga a pasta do contexto-savio: npm run importar-memoria -- <pasta>");
    process.exit(1);
  }
  // No PC o endereço do banco fica no hub/.env.local (no Railway vem do ambiente).
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Falta a variável DATABASE_URL (endereço do Postgres).");
    process.exit(1);
  }

  const i = process.argv.indexOf("--organizacao");
  const organizacao = i === -1 ? ORGANIZACAO_PADRAO.id : process.argv[i + 1];
  if (!ehIdDeOrganizacao(organizacao)) {
    console.error("O --organizacao precisa ser o id da organização (aparece na tela Plataforma).");
    process.exit(1);
  }

  const r = await comOrganizacao(organizacao, () => importarMemoria({ pastaSavio: path.resolve(pasta) }));
  console.log(`Origem: contexto-savio, commit ${r.commit}`);
  console.log(`Criados: ${r.criados.length}${r.criados.length ? ` (${r.criados.join(", ")})` : ""}`);
  console.log(`Atualizados: ${r.atualizados.length}${r.atualizados.length ? ` (${r.atualizados.join(", ")})` : ""}`);
  console.log(`Iguais (pulados): ${r.iguais.length}`);
  if (r.recusados.length) {
    console.log(`Recusados: ${r.recusados.length}`);
    for (const x of r.recusados) console.log(`  - ${x.slug}: ${x.erro}`);
  }
  process.exit(r.recusados.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
