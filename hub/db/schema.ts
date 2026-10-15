// Todas as tabelas do hub, reunidas para o Drizzle (consultas e migrações).
// Cada funcionalidade declara as suas em features/<nome>/tabelas.ts.
// Só caminhos relativos aqui e nos tabelas.ts: o drizzle-kit não entende o atalho "@/".

export * from "../features/acesso/tabelas";
export * from "../features/memoria/tabelas";
export * from "../features/conector/tabelas";
