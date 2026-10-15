CREATE TABLE "drive_conta" (
	"id" text PRIMARY KEY DEFAULT 'unica' NOT NULL,
	"email" text NOT NULL,
	"nome" text,
	"refresh_token_cifrado" text NOT NULL,
	"access_token_cifrado" text,
	"expira_em" timestamp with time zone,
	"escopos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conectado_por" uuid,
	"conectado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_conta_linha_unica" CHECK ("drive_conta"."id" = 'unica')
);
--> statement-breakpoint
CREATE TABLE "drive_pedidos_login" (
	"state" text PRIMARY KEY NOT NULL,
	"verifier_cifrado" text NOT NULL,
	"volta" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"iniciado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_conta" ADD CONSTRAINT "drive_conta_conectado_por_usuarios_id_fk" FOREIGN KEY ("conectado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_pedidos_login" ADD CONSTRAINT "drive_pedidos_login_iniciado_por_usuarios_id_fk" FOREIGN KEY ("iniciado_por") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;