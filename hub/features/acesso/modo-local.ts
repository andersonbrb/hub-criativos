import type { Usuario } from "@/features/acesso/contrato";

// PC sem Postgres (uso local do dono, como era antes das contas): sem banco não há contas, então o hub abre direto,
// com o dono local. Nunca vale no Railway (lá existe RAILWAY_ENVIRONMENT_NAME) nem com banco configurado.
// Só servidor e proxy chamam isto: no navegador as variáveis não existem e a resposta seria sempre "sim".
export const modoLocalSemBanco = () => !process.env.DATABASE_URL?.trim() && !process.env.RAILWAY_ENVIRONMENT_NAME?.trim();

export const DONO_LOCAL: Usuario = { id: "local", email: "dono@este-pc", nome: "Dono (este PC)", papel: "dono", ativo: true, chaves: [] };
