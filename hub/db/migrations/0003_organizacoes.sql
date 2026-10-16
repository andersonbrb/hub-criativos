-- Organizações (como no Cifra): cada uma tem a própria equipe e os próprios dados. Tudo o que existia antes passa a
-- ser da organização padrão, Grupo Chegou (id fixo, o mesmo de ORGANIZACAO_PADRAO em features/acesso/contrato.ts).
-- Escrita à mão a partir do schema (o drizzle-kit pede confirmações interativas para as colunas que mudam de lugar);
-- o snapshot 0003 é o do schema, e o teste features/acesso/testes/migracao-organizacoes.test.ts confere que o banco
-- migrado bate com ele.
CREATE TABLE "organizacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"situacao" text DEFAULT 'ativa' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizacao_membros" (
	"organizacao_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"papel" text DEFAULT 'membro' NOT NULL,
	"chaves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"entrou_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizacao_membros_organizacao_id_usuario_id_pk" PRIMARY KEY("organizacao_id","usuario_id")
);
--> statement-breakpoint
INSERT INTO "organizacoes" ("id", "nome") VALUES ('00000000-0000-4000-8000-000000000001', 'Grupo Chegou');
--> statement-breakpoint
-- A equipe de hoje entra inteira na Grupo Chegou, com o mesmo papel, as mesmas telas e a mesma situação.
INSERT INTO "organizacao_membros" ("organizacao_id", "usuario_id", "papel", "chaves", "ativo", "entrou_em")
	SELECT '00000000-0000-4000-8000-000000000001', "id", "papel", "chaves", "ativo", "criado_em" FROM "usuarios";
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "opera_plataforma" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "ultima_organizacao_id" uuid;
--> statement-breakpoint
-- O dono de antes (dado pelo script criar-dono) passa a operar a plataforma.
UPDATE "usuarios" SET "opera_plataforma" = true WHERE "papel" = 'dono';
--> statement-breakpoint
UPDATE "usuarios" SET "ultima_organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "usuarios" DROP COLUMN "papel";
--> statement-breakpoint
ALTER TABLE "usuarios" DROP COLUMN "ativo";
--> statement-breakpoint
ALTER TABLE "usuarios" DROP COLUMN "chaves";
--> statement-breakpoint
ALTER TABLE "sessoes" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "sessoes" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "convites" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "convites" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "convites" ALTER COLUMN "organizacao_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "memoria_documentos" DROP CONSTRAINT "memoria_documentos_slug_unique";
--> statement-breakpoint
DROP INDEX "memoria_documentos_tipo_idx";
--> statement-breakpoint
ALTER TABLE "memoria_documentos" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "memoria_documentos" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "memoria_documentos" ALTER COLUMN "organizacao_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "memoria_documentos" ADD CONSTRAINT "memoria_documentos_org_slug_unq" UNIQUE("organizacao_id","slug");
--> statement-breakpoint
CREATE INDEX "memoria_documentos_tipo_idx" ON "memoria_documentos" USING btree ("organizacao_id","tipo","slug");
--> statement-breakpoint
-- O Drive conectado hoje é o da Grupo Chegou.
ALTER TABLE "drive_conta" DROP CONSTRAINT "drive_conta_linha_unica";
--> statement-breakpoint
ALTER TABLE "drive_conta" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "drive_conta" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "drive_conta" DROP CONSTRAINT "drive_conta_pkey";
--> statement-breakpoint
ALTER TABLE "drive_conta" DROP COLUMN "id";
--> statement-breakpoint
ALTER TABLE "drive_conta" ALTER COLUMN "organizacao_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "drive_conta" ADD PRIMARY KEY ("organizacao_id");
--> statement-breakpoint
ALTER TABLE "drive_conta" ADD CONSTRAINT "drive_conta_email_unique" UNIQUE("email");
--> statement-breakpoint
-- Logins do Google em andamento valem 10 minutos: os que estiverem no meio recomeçam.
DELETE FROM "drive_pedidos_login";
--> statement-breakpoint
ALTER TABLE "drive_pedidos_login" ADD COLUMN "organizacao_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "conexoes" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "conexoes" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "conexoes" ALTER COLUMN "organizacao_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "oauth_codigos" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "oauth_codigos" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "oauth_codigos" ALTER COLUMN "organizacao_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "conector_links" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "conector_links" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "conector_links" ALTER COLUMN "organizacao_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chamadas_mcp" ADD COLUMN "organizacao_id" uuid;
--> statement-breakpoint
UPDATE "chamadas_mcp" SET "organizacao_id" = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
ALTER TABLE "organizacoes" ADD CONSTRAINT "organizacoes_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizacao_membros" ADD CONSTRAINT "organizacao_membros_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizacao_membros" ADD CONSTRAINT "organizacao_membros_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_ultima_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("ultima_organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites" ADD CONSTRAINT "convites_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memoria_documentos" ADD CONSTRAINT "memoria_documentos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_conta" ADD CONSTRAINT "drive_conta_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_pedidos_login" ADD CONSTRAINT "drive_pedidos_login_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conexoes" ADD CONSTRAINT "conexoes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codigos" ADD CONSTRAINT "oauth_codigos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamadas_mcp" ADD CONSTRAINT "chamadas_mcp_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conector_links" ADD CONSTRAINT "conector_links_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizacao_membros_usuario_idx" ON "organizacao_membros" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "convites_organizacao_idx" ON "convites" USING btree ("organizacao_id");
