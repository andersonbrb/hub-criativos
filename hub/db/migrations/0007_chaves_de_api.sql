CREATE TABLE "chaves_api" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"comeco" text NOT NULL,
	"token_hash" text NOT NULL,
	"criada_por" uuid,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_uso_em" timestamp with time zone,
	"revogada_em" timestamp with time zone,
	"revogada_por" uuid,
	CONSTRAINT "chaves_api_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "skala_entregas" ADD COLUMN "chave_api_id" uuid;--> statement-breakpoint
ALTER TABLE "chaves_api" ADD CONSTRAINT "chaves_api_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chaves_api" ADD CONSTRAINT "chaves_api_criada_por_usuarios_id_fk" FOREIGN KEY ("criada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chaves_api" ADD CONSTRAINT "chaves_api_revogada_por_usuarios_id_fk" FOREIGN KEY ("revogada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chaves_api_organizacao_idx" ON "chaves_api" USING btree ("organizacao_id");--> statement-breakpoint
ALTER TABLE "skala_entregas" ADD CONSTRAINT "skala_entregas_chave_api_id_chaves_api_id_fk" FOREIGN KEY ("chave_api_id") REFERENCES "public"."chaves_api"("id") ON DELETE set null ON UPDATE no action;