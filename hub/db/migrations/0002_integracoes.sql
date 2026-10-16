CREATE TABLE "integracoes_chaves" (
	"nome" text PRIMARY KEY NOT NULL,
	"valor_cifrado" text,
	"atualizado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integracoes_chaves" ADD CONSTRAINT "integracoes_chaves_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;