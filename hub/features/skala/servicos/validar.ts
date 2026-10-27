import "server-only";

import {
  MAXIMO_DE_ANUNCIOS,
  MAXIMO_DE_CAMPOS_POR_ANUNCIO,
  MAXIMO_DE_CRIATIVOS,
  MAXIMO_DE_METRICAS,
  PEDIDO_PADRAO,
  PEDIDO_PADRAO_VARIOS,
  TAMANHO_DO_CAMPO,
  TAMANHO_DO_PEDIDO,
  TAMANHO_DO_TEXTO,
  dominioDaMidiaAceito,
  type CriativoDoSkala,
  type EntregaDoSkala,
  type Valor,
} from "@/features/skala/contrato";
import { InputError } from "@/lib/server/http";

// Confere o JSON que o servidor do Skala manda e devolve só o que o hub guarda. Campo desconhecido é ignorado (o
// Skala pode mandar a mais sem quebrar); campo conhecido com tipo errado é recusado com a explicação.
// Os nomes seguem o jeito do Skala (Python): video_url, imagem_url, capa_url.

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);

// Tira caracteres de controle (menos quebra de linha e tab) e corta no tamanho.
const limpar = (s: string, max: number) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

function texto(o: Objeto, campo: string, onde: string, max = TAMANHO_DO_CAMPO): string | undefined {
  const v = o[campo];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") throw new InputError(`${onde}: "${campo}" precisa ser texto.`);
  return limpar(v, max) || undefined;
}

function endereco(o: Objeto, campo: string, onde: string): string | undefined {
  const v = texto(o, campo, onde, 4000);
  if (!v) return undefined;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new InputError(`${onde}: "${campo}" não é um endereço.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new InputError(`${onde}: "${campo}" precisa começar com https://.`);
  return url.toString();
}

// Endereço de mídia: só de domínio aceito (o Skala e os CDNs em que ficam os criativos).
function enderecoDeMidia(o: Objeto, campo: string, onde: string): string | undefined {
  const v = endereco(o, campo, onde);
  if (v && !dominioDaMidiaAceito(new URL(v).hostname)) {
    throw new InputError(`${onde}: o hub só baixa "${campo}" do Skala ou do CDN do TikTok, da Meta e do Cloudinary (veio de ${new URL(v).hostname}).`);
  }
  return v;
}

function valor(v: unknown): Valor | undefined {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return limpar(v, TAMANHO_DO_CAMPO);
  return undefined;
}

// Mapa rótulo → valor (texto, número, sim/não). Itens com valor de outro tipo são ignorados.
function mapa(v: unknown, campo: string, onde: string, max: number): Record<string, Valor> | undefined {
  if (v === undefined || v === null) return undefined;
  if (!ehObjeto(v)) throw new InputError(`${onde}: "${campo}" precisa ser um objeto { "rótulo": valor }.`);
  const saida: Record<string, Valor> = {};
  for (const [k, bruto] of Object.entries(v).slice(0, max)) {
    const rotulo = limpar(k, 80);
    const val = valor(bruto);
    if (rotulo && val !== undefined) saida[rotulo] = val;
  }
  return Object.keys(saida).length ? saida : undefined;
}

function paises(v: unknown, onde: string): string[] | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const lista = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v : null;
  if (!lista) throw new InputError(`${onde}: "paises" precisa ser uma lista de textos.`);
  const saida = lista.filter((p): p is string => typeof p === "string").map((p) => limpar(p, 60)).filter(Boolean).slice(0, 30);
  return saida.length ? saida : undefined;
}

function criativo(v: unknown, i: number): CriativoDoSkala {
  const onde = `criativos[${i}]`;
  if (!ehObjeto(v)) throw new InputError(`${onde} precisa ser um objeto.`);
  const id = texto(v, "id", onde, 120);
  if (!id) throw new InputError(`${onde}: falta o "id" do criativo no Skala.`);
  const anuncios = v.anuncios;
  if (anuncios !== undefined && anuncios !== null && !Array.isArray(anuncios)) throw new InputError(`${onde}: "anuncios" precisa ser uma lista.`);
  const c: CriativoDoSkala = {
    id,
    nome: texto(v, "nome", onde) ?? `Criativo ${id}`,
    plataforma: texto(v, "plataforma", onde, 40),
    produto: texto(v, "produto", onde),
    paises: paises(v.paises, onde),
    periodo: texto(v, "periodo", onde, 120),
    link: endereco(v, "link", onde),
    texto: texto(v, "texto", onde, TAMANHO_DO_TEXTO),
    titulo: texto(v, "titulo", onde),
    chamada: texto(v, "chamada", onde, 120),
    videoUrl: enderecoDeMidia(v, "video_url", onde),
    imagemUrl: enderecoDeMidia(v, "imagem_url", onde),
    capaUrl: enderecoDeMidia(v, "capa_url", onde),
    metricas: mapa(v.metricas, "metricas", onde, MAXIMO_DE_METRICAS),
    anuncios: Array.isArray(anuncios)
      ? anuncios
          .slice(0, MAXIMO_DE_ANUNCIOS)
          .map((a, j) => mapa(a, `anuncios[${j}]`, onde, MAXIMO_DE_CAMPOS_POR_ANUNCIO))
          .filter((a): a is Record<string, Valor> => Boolean(a))
      : undefined,
  };
  // Sem undefined no JSON guardado.
  return Object.fromEntries(Object.entries(c).filter(([, x]) => x !== undefined && !(Array.isArray(x) && !x.length))) as CriativoDoSkala;
}

// { "criativos": [ ... ], "pedido"?: "..." }. Um criativo só também pode vir em "criativo".
export function lerEntrega(corpo: unknown): EntregaDoSkala {
  if (!ehObjeto(corpo)) throw new InputError('O corpo precisa ser um JSON: { "criativos": [ { "id": "...", ... } ] }.');
  const lista = Array.isArray(corpo.criativos) ? corpo.criativos : corpo.criativo !== undefined ? [corpo.criativo] : null;
  if (!lista?.length) throw new InputError('Falta "criativos": a lista com pelo menos um criativo.');
  if (lista.length > MAXIMO_DE_CRIATIVOS) throw new InputError(`No máximo ${MAXIMO_DE_CRIATIVOS} criativos por vez.`);
  const criativos = lista.map(criativo);
  const pedido = texto(corpo, "pedido", "pedido", TAMANHO_DO_PEDIDO) ?? (criativos.length > 1 ? PEDIDO_PADRAO_VARIOS : PEDIDO_PADRAO);
  return { criativos, pedido };
}
