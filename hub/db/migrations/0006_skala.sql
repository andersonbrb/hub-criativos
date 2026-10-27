CREATE TABLE "skala_entregas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"criativos" json NOT NULL,
	"pedido" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"usado_por" uuid,
	"chat_id" text,
	"ip" text,
	CONSTRAINT "skala_entregas_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "skala_entregas" ADD CONSTRAINT "skala_entregas_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skala_entregas" ADD CONSTRAINT "skala_entregas_usado_por_usuarios_id_fk" FOREIGN KEY ("usado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skala_entregas_organizacao_idx" ON "skala_entregas" USING btree ("organizacao_id");