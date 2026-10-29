CREATE TABLE "instagram_documentos" (
	"organizacao_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"id" text NOT NULL,
	"versao" integer NOT NULL,
	"dados" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_documentos_organizacao_id_tipo_id_pk" PRIMARY KEY("organizacao_id","tipo","id")
);
--> statement-breakpoint
CREATE TABLE "instagram_eventos" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"ocorreu_em" timestamp with time zone NOT NULL,
	"dados" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instagram_documentos" ADD CONSTRAINT "instagram_documentos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_eventos" ADD CONSTRAINT "instagram_eventos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instagram_documentos_dados_gin" ON "instagram_documentos" USING gin ("dados" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "instagram_eventos_organizacao_idx" ON "instagram_eventos" USING btree ("organizacao_id","ocorreu_em");