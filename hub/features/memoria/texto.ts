// Regras de texto da Memória, puras (servidor, importador e tela usam).

// Minúsculo e sem acento. A busca compara tudo assim, para "tradução" achar "traducao" e vice-versa.
// Feito aqui, e não no Postgres, porque o banco não tem a extensão unaccent.
export const normalizar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Forma única do conteúdo gravado: quebra de linha do Windows vira \n e o fim tem uma quebra só. Assim a caixa de
// texto da tela (que perde a última quebra) e o importador não criam versão nova sem mudança real.
export const normalizarConteudo = (s: string) => `${s.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trimEnd()}\n`;

// Texto guardado na coluna de busca: título na primeira linha (a busca pesa mais o título) e o conteúdo depois.
export const textoDeBusca = (titulo: string, conteudo: string) => `${normalizar(titulo).replace(/\s+/g, " ").trim()}\n${normalizar(conteudo)}`;

// Primeiro "# Título" do markdown (pula o cabeçalho --- de metadados, se houver).
export function tituloDoMarkdown(md: string): string | null {
  const semCabecalho = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  const m = semCabecalho.match(/^#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].trim() : null;
}

// Palavras da consulta que vale procurar no texto (sem operadores da busca: or, -palavra, aspas).
export function termosDaConsulta(consulta: string): string[] {
  const termos = normalizar(consulta)
    .split(/\s+/)
    .filter((p) => p && !p.startsWith("-") && p !== "or")
    .flatMap((p) => p.split(/[^\p{L}\p{N}]+/u))
    .filter((p) => p.length >= 2);
  return [...new Set(termos)];
}

// Trecho de ~300 caracteres do texto ORIGINAL (com acento) em volta da primeira ocorrência de um dos termos.
export function trechoEmVolta(conteudo: string, termos: string[], tamanho = 300): string {
  // Mapa posição-no-normalizado → posição-no-original: tirar acento pode mudar o comprimento do texto.
  let norm = "";
  const origem: number[] = [];
  for (let i = 0; i < conteudo.length; ) {
    const ch = String.fromCodePoint(conteudo.codePointAt(i)!);
    const n = normalizar(ch);
    for (let k = 0; k < n.length; k++) origem.push(i);
    norm += n;
    i += ch.length;
  }
  let pos = -1;
  for (const t of termos) {
    const p = norm.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  const centro = pos >= 0 ? origem[pos] : 0;
  let inicio = Math.max(0, centro - Math.floor(tamanho / 3));
  let fim = Math.min(conteudo.length, inicio + tamanho);
  inicio = Math.max(0, fim - tamanho);
  // Não corta palavra no meio.
  if (inicio > 0) {
    const espaco = conteudo.indexOf(" ", inicio);
    if (espaco >= 0 && espaco < centro) inicio = espaco + 1;
  }
  if (fim < conteudo.length) {
    const espaco = conteudo.lastIndexOf(" ", fim);
    if (espaco > Math.max(inicio, centro)) fim = espaco;
  }
  const meio = conteudo.slice(inicio, fim).replace(/\s+/g, " ").trim();
  return `${inicio > 0 ? "…" : ""}${meio}${fim < conteudo.length ? "…" : ""}`;
}

// Os textos vieram de um repositório com links relativos entre arquivos (ex.: "../05-traducao-de-criativos.md",
// "projetos/dewalt-ads-cl.md"). Na Memória cada arquivo virou um documento: o link passa a apontar para ele.
export function slugDoArquivo(href: string, existe: (slug: string) => boolean): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
  const nome = href.split(/[?#]/)[0].split("/").pop()?.replace(/\.md$/i, "");
  if (!nome || !/\.md($|[?#])/i.test(href)) return null;
  const fixos: Record<string, string> = {
    README: "leia-primeiro",
    _MODELO: "modelo-de-documento",
    "00-indice-projetos": "projetos-indice-original",
  };
  const candidatos = [fixos[nome], nome, `projeto-${nome}`, `playbook-${nome}`].filter(Boolean) as string[];
  return candidatos.find(existe) ?? null;
}

// Link para arquivo que não virou documento fica só como texto (o caminho antigo não abre nada no hub).
export function trocarLinksMd(md: string, existe: (slug: string) => boolean): string {
  return md.replace(/\[([^\]]*)\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/gi, (todo, texto: string, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return todo;
    const slug = slugDoArquivo(href, existe);
    return slug ? `[${texto}](/memoria/${slug})` : texto;
  });
}
