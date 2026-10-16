import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { getTableName, is } from "drizzle-orm";
import { pushSchema } from "drizzle-kit/api";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";

// A migração das organizações roda num banco com os dados de antes (como o do Railway) e confere que tudo passou para
// a Grupo Chegou. No fim, o banco migrado precisa bater com o schema do código (o snapshot mais recente).

const PASTA = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const ORG = ORGANIZACAO_PADRAO.id;
const temporarias: string[] = [];

// Cópia da pasta de migrações só com as N primeiras (para pôr os dados de antes no meio do caminho).
function primeiras(n: number) {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "hub-migracoes-"));
  temporarias.push(pasta);
  // Cópia arquivo por arquivo: o cpSync do Node derruba o processo no Windows com acento no caminho ("Programação").
  mkdirSync(path.join(pasta, "meta"));
  for (const nome of readdirSync(PASTA)) if (nome.endsWith(".sql")) copyFileSync(path.join(PASTA, nome), path.join(pasta, nome));
  for (const nome of readdirSync(path.join(PASTA, "meta"))) copyFileSync(path.join(PASTA, "meta", nome), path.join(pasta, "meta", nome));
  const diario = path.join(pasta, "meta", "_journal.json");
  const conteudo = JSON.parse(readFileSync(diario, "utf8"));
  conteudo.entries = conteudo.entries.slice(0, n);
  writeFileSync(diario, JSON.stringify(conteudo));
  return pasta;
}

afterAll(() => {
  for (const p of temporarias) rmSync(p, { recursive: true, force: true });
});

describe("migração 0003: organizações", () => {
  it("leva a equipe, a memória, o Drive e o conector de antes para a Grupo Chegou", async () => {
    const pg = new PGlite();
    const db = drizzle(pg);
    await migrate(db, { migrationsFolder: primeiras(3) });

    await pg.exec(`
      INSERT INTO usuarios (id, email, nome, senha_hash, papel, ativo, chaves) VALUES
        ('11111111-1111-4111-8111-111111111111', 'dono@ex.com', 'Dono', 'h', 'dono', true, '[]'),
        ('22222222-2222-4222-8222-222222222222', 'admin@ex.com', 'Admin', 'h', 'admin', false, '[]'),
        ('33333333-3333-4333-8333-333333333333', 'membro@ex.com', 'Membro', 'h', 'membro', true, '["chat","fluxo"]');
      INSERT INTO sessoes (usuario_id, token_hash, expira_em) VALUES ('11111111-1111-4111-8111-111111111111', 'abc', now() + interval '1 day');
      INSERT INTO convites (email, papel, chaves, token_hash, expira_em) VALUES ('novo@ex.com', 'membro', '["chat"]', 'conv', now() + interval '1 day');
      INSERT INTO memoria_documentos (slug, titulo, tipo, conteudo_atual, autor_atual) VALUES ('01-regras', 'Regras', 'regra', 'texto', 'Dono');
      INSERT INTO drive_conta (email, refresh_token_cifrado) VALUES ('drive@ex.com', 'x');
      INSERT INTO drive_pedidos_login (state, verifier_cifrado, volta, redirect_uri) VALUES ('st', 'v', '/integracoes', 'https://hub/cb');
      INSERT INTO oauth_clientes (id, client_id) VALUES ('44444444-4444-4444-8444-444444444444', 'cliente');
      INSERT INTO conexoes (id, usuario_id, cliente_id, app, audiencia) VALUES
        ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'claude_code', 'https://hub/mcp');
      INSERT INTO oauth_codigos (codigo_hash, cliente_id, usuario_id, redirect_uri, code_challenge, resource, expira_em) VALUES
        ('cod', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'http://localhost/cb', 'ch', 'https://hub/mcp', now());
      INSERT INTO conector_links (tipo, token_hash, usuario_id, expira_em) VALUES ('envio', 'lnk', '33333333-3333-4333-8333-333333333333', now());
      INSERT INTO chamadas_mcp (usuario_id, ferramenta) VALUES ('33333333-3333-4333-8333-333333333333', 'fluxo_ver');
    `);

    await migrate(db, { migrationsFolder: PASTA });

    const linhas = async (q: string) => (await pg.query<Record<string, unknown>>(q)).rows;
    expect(await linhas(`SELECT id, nome, situacao FROM organizacoes`)).toEqual([{ id: ORG, nome: "Grupo Chegou", situacao: "ativa" }]);
    expect(await linhas(`SELECT u.email, m.papel, m.ativo, m.chaves FROM organizacao_membros m JOIN usuarios u ON u.id = m.usuario_id ORDER BY u.email`)).toEqual([
      { email: "admin@ex.com", papel: "admin", ativo: false, chaves: [] },
      { email: "dono@ex.com", papel: "dono", ativo: true, chaves: [] },
      { email: "membro@ex.com", papel: "membro", ativo: true, chaves: ["chat", "fluxo"] },
    ]);
    expect(await linhas(`SELECT email, opera_plataforma, ultima_organizacao_id FROM usuarios ORDER BY email`)).toEqual([
      { email: "admin@ex.com", opera_plataforma: false, ultima_organizacao_id: ORG },
      { email: "dono@ex.com", opera_plataforma: true, ultima_organizacao_id: ORG },
      { email: "membro@ex.com", opera_plataforma: false, ultima_organizacao_id: ORG },
    ]);
    for (const tabela of ["sessoes", "convites", "memoria_documentos", "drive_conta", "conexoes", "oauth_codigos", "conector_links", "chamadas_mcp"]) {
      expect(await linhas(`SELECT DISTINCT organizacao_id FROM ${tabela}`), tabela).toEqual([{ organizacao_id: ORG }]);
    }
    // Logins do Google pela metade recomeçam.
    expect(await linhas(`SELECT * FROM drive_pedidos_login`)).toEqual([]);

  });

  it("o banco migrado tem a mesma estrutura que o schema do código", async () => {
    // Um banco pelas migrações e outro direto do schema: colunas, restrições e índices iguais. Só entram as tabelas
    // que o snapshot mais recente já conhece (uma tabela nova ainda sem migração entra na migração dela).
    const diario = JSON.parse(readFileSync(path.join(PASTA, "meta", "_journal.json"), "utf8"));
    const ultimo = diario.entries.at(-1).idx.toString().padStart(4, "0");
    const snapshot = JSON.parse(readFileSync(path.join(PASTA, "meta", `${ultimo}_snapshot.json`), "utf8"));
    const conhecidas = new Set(Object.values(snapshot.tables as Record<string, { name: string }>).map((t) => t.name));
    const doSchema = Object.fromEntries(Object.entries(schema).filter(([, t]) => is(t, PgTable) && conhecidas.has(getTableName(t as PgTable))));

    const migrado = new PGlite();
    await migrate(drizzle(migrado), { migrationsFolder: PASTA });
    const direto = new PGlite();
    await (await pushSchema(doSchema, drizzle(direto) as never)).apply();

    const estrutura = async (pg: PGlite) => ({
      colunas: (
        await pg.query(
          `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`,
        )
      ).rows,
      restricoes: (
        await pg.query(
          `SELECT conrelid::regclass::text AS tabela, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
        )
      ).rows,
      indices: (await pg.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`)).rows,
    });
    expect(await estrutura(migrado)).toEqual(await estrutura(direto));
  });
});
