CREATE TABLE "youtube_conta" (
	"organizacao_id" uuid PRIMARY KEY NOT NULL,
	"canal_id" text NOT NULL,
	"canal_titulo" text NOT NULL,
	"canal_foto" text,
	"canal_endereco" text,
	"refresh_token_cifrado" text NOT NULL,
	"access_token_cifrado" text,
	"expira_em" timestamp with time zone,
	"escopos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conectado_por" uuid,
	"conectado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_conta_canal_id_unique" UNIQUE("canal_id")
);
--> statement-breakpoint
CREATE TABLE "youtube_envios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"geracao_id" text NOT NULL,
	"arquivo" text NOT NULL,
	"canal_id" text NOT NULL,
	"canal_titulo" text NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"visibilidade" text NOT NULL,
	"para_criancas" boolean DEFAULT false NOT NULL,
	"shorts" boolean DEFAULT false NOT NULL,
	"miniatura" text,
	"agendado_para" timestamp with time zone,
	"situacao" text NOT NULL,
	"progresso" integer,
	"sessao_cifrada" text,
	"video_id" text,
	"erro" text,
	"aviso" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"enviado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "youtube_pedidos_login" (
	"state" text PRIMARY KEY NOT NULL,
	"verifier_cifrado" text NOT NULL,
	"volta" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"iniciado_por" uuid,
	"organizacao_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "youtube_conta" ADD CONSTRAINT "youtube_conta_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_conta" ADD CONSTRAINT "youtube_conta_conectado_por_usuarios_id_fk" FOREIGN KEY ("conectado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_envios" ADD CONSTRAINT "youtube_envios_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_envios" ADD CONSTRAINT "youtube_envios_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_pedidos_login" ADD CONSTRAINT "youtube_pedidos_login_iniciado_por_usuarios_id_fk" FOREIGN KEY ("iniciado_por") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_pedidos_login" ADD CONSTRAINT "youtube_pedidos_login_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "youtube_envios_organizacao_idx" ON "youtube_envios" USING btree ("organizacao_id","criado_em");--> statement-breakpoint
CREATE INDEX "youtube_envios_fila_idx" ON "youtube_envios" USING btree ("situacao","agendado_para");