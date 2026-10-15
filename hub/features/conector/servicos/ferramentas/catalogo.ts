import "server-only";

import { podeUsar, type Usuario } from "@/features/acesso/contrato";
import { FERRAMENTAS_DA_BIBLIOTECA } from "@/features/conector/servicos/ferramentas/biblioteca";
import type { Ferramenta } from "@/features/conector/servicos/ferramentas/comum";
import { FERRAMENTAS_DO_FLUXO } from "@/features/conector/servicos/ferramentas/fluxo";
import { FERRAMENTA_INSTRUCOES } from "@/features/conector/servicos/ferramentas/instrucoes";
import { FERRAMENTAS_DA_MEMORIA } from "@/features/conector/servicos/ferramentas/memoria";

// Todas as ferramentas do conector, na ordem em que aparecem para o Claude. A lista que cada pessoa vê sai daqui,
// filtrada pelas chaves da conta NAQUELE momento; e toda execução reconfere a chave (servicos/mcp.ts).
export const FERRAMENTAS: Ferramenta[] = [FERRAMENTA_INSTRUCOES, ...FERRAMENTAS_DA_MEMORIA, ...FERRAMENTAS_DA_BIBLIOTECA, ...FERRAMENTAS_DO_FLUXO];

const PELO_NOME = new Map(FERRAMENTAS.map((f) => [f.definicao.name, f]));

export const acharFerramenta = (nome: string) => PELO_NOME.get(nome);

export const liberada = (f: Ferramenta, usuario: Usuario) => f.chave === null || podeUsar(usuario, f.chave);

export const ferramentasDe = (usuario: Usuario) => FERRAMENTAS.filter((f) => liberada(f, usuario));
