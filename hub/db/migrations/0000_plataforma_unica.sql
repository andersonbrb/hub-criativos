CREATE TABLE "convites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nome" text,
	"papel" text DEFAULT 'membro' NOT NULL,
	"chaves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	CONSTRAINT "convites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"ultimo_uso_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"navegador" text,
	CONSTRAINT "sessoes_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"senha_hash" text,
	"papel" text DEFAULT 'membro' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"chaves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_acesso_em" timestamp with time zone,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "memoria_documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"titulo" text NOT NULL,
	"tipo" text NOT NULL,
	"frente" text DEFAULT 'geral' NOT NULL,
	"mercado" text,
	"no_prompt" boolean DEFAULT false NOT NULL,
	"precisa_revisao" boolean DEFAULT false NOT NULL,
	"metadados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"versao_atual" integer DEFAULT 1 NOT NULL,
	"conteudo_atual" text NOT NULL,
	"autor_atual" text NOT NULL,
	"busca" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memoria_documentos_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "memoria_versoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"versao" integer NOT NULL,
	"conteudo" text NOT NULL,
	"sha256" text NOT NULL,
	"autor_id" uuid,
	"autor_nome" text NOT NULL,
	"nota" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memoria_versoes_doc_versao_unq" UNIQUE("doc_id","versao")
);
--> statement-breakpoint
CREATE TABLE "chamadas_mcp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid,
	"conexao_id" uuid,
	"ferramenta" text NOT NULL,
	"argumentos" text DEFAULT '' NOT NULL,
	"duracao_ms" integer DEFAULT 0 NOT NULL,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conector_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"token_hash" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"nome_arquivo" text,
	"generation_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	CONSTRAINT "conector_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "conexao_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conexao_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"token_hash" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"revogado_em" timestamp with time zone,
	CONSTRAINT "conexao_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "conexoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"app" text NOT NULL,
	"escopos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audiencia" text NOT NULL,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_uso_em" timestamp with time zone,
	"revogada_em" timestamp with time zone,
	"motivo_revogacao" text,
	"revogada_por" uuid
);
--> statement-breakpoint
CREATE TABLE "oauth_clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"nome" text DEFAULT '' NOT NULL,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ip_registro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clientes_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_codigos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo_hash" text NOT NULL,
	"cliente_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text NOT NULL,
	"escopos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"conexao_id" uuid,
	CONSTRAINT "oauth_codigos_codigo_hash_unique" UNIQUE("codigo_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_pedidos" (
	"id" text PRIMARY KEY NOT NULL,
	"cliente_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"escopos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resource" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"decidido_em" timestamp with time zone,
	"decisao" text,
	"decidido_por" uuid
);
--> statement-breakpoint
ALTER TABLE "convites" ADD CONSTRAINT "convites_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memoria_versoes" ADD CONSTRAINT "memoria_versoes_doc_id_memoria_documentos_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."memoria_documentos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memoria_versoes" ADD CONSTRAINT "memoria_versoes_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamadas_mcp" ADD CONSTRAINT "chamadas_mcp_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamadas_mcp" ADD CONSTRAINT "chamadas_mcp_conexao_id_conexoes_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."conexoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conector_links" ADD CONSTRAINT "conector_links_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conexao_tokens" ADD CONSTRAINT "conexao_tokens_conexao_id_conexoes_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."conexoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conexoes" ADD CONSTRAINT "conexoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conexoes" ADD CONSTRAINT "conexoes_cliente_id_oauth_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."oauth_clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conexoes" ADD CONSTRAINT "conexoes_revogada_por_usuarios_id_fk" FOREIGN KEY ("revogada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codigos" ADD CONSTRAINT "oauth_codigos_cliente_id_oauth_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."oauth_clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codigos" ADD CONSTRAINT "oauth_codigos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codigos" ADD CONSTRAINT "oauth_codigos_conexao_id_conexoes_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."conexoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_pedidos" ADD CONSTRAINT "oauth_pedidos_cliente_id_oauth_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."oauth_clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_pedidos" ADD CONSTRAINT "oauth_pedidos_decidido_por_usuarios_id_fk" FOREIGN KEY ("decidido_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessoes_usuario_idx" ON "sessoes" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "memoria_documentos_busca_idx" ON "memoria_documentos" USING gin (to_tsvector('simple', "busca"));--> statement-breakpoint
CREATE INDEX "memoria_documentos_tipo_idx" ON "memoria_documentos" USING btree ("tipo","slug");--> statement-breakpoint
CREATE INDEX "chamadas_mcp_conexao_idx" ON "chamadas_mcp" USING btree ("conexao_id","criado_em");--> statement-breakpoint
CREATE INDEX "conexao_tokens_conexao_idx" ON "conexao_tokens" USING btree ("conexao_id");--> statement-breakpoint
CREATE INDEX "conexoes_usuario_idx" ON "conexoes" USING btree ("usuario_id","revogada_em");--> statement-breakpoint
CREATE INDEX "oauth_pedidos_cliente_idx" ON "oauth_pedidos" USING btree ("cliente_id");