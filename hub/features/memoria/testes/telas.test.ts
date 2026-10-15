import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Doc, DocResumo, LinhaProjeto } from "@/features/memoria/contrato";
import { DocView } from "@/features/memoria/tela/doc-view";
import { MemoriaView } from "@/features/memoria/tela/memoria-view";

// As telas desenham no servidor sem erro (a interação é conferida no navegador).
// O React separa textos vizinhos com <!-- -->: some antes de comparar.
const desenhar = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replaceAll("<!-- -->", "");
const resumo: DocResumo = {
  slug: "21-github",
  titulo: "GitHub: como manter",
  tipo: "regra",
  frente: "geral",
  mercado: null,
  noPrompt: false,
  precisaRevisao: true,
  versao: 2,
  atualizadoEm: "2026-10-15T17:30:00.000Z",
  metadados: { motivoRevisao: "o repositório deixou de existir" },
};
const projeto: LinhaProjeto = {
  slug: "projeto-dewalt",
  titulo: "DeWalt",
  frente: "cod",
  frenteOriginal: "COD",
  mercado: "Chile",
  status: "Entregue",
  data: "2026-10-09",
  precisaRevisao: false,
  atualizadoEm: "2026-10-15T17:30:00.000Z",
};

describe("telas da Memória", () => {
  it("índice com abas", () => {
    const html = desenhar(createElement(MemoriaView, { documentos: [resumo], projetos: [projeto], pendentes: [resumo], abaInicial: "documentos" }));
    expect(html).toContain("Memória");
    expect(html).toContain("Precisa de revisão (1)");
    expect(html).toContain("GitHub: como manter");
    expect(html).toContain("15/10/2026");
  });

  it("documento com markdown e links trocados", () => {
    const doc: Doc = {
      ...resumo,
      autor: "Sávio",
      conteudo: "# GitHub: como manter\n\n> Uma linha.\n\n## Contexto de uso\nVeja [o modelo](_MODELO.md) e [sumido](x.md).\n",
    };
    const html = desenhar(createElement(DocView, { inicial: doc, slugs: ["modelo-de-documento"], podeEditar: true }));
    expect(html).toContain("Editar");
    expect(html).toContain("Marcar como revisado");
    expect(html).toContain('href="/memoria/modelo-de-documento"');
    expect(html).toContain("Versão 2 · Sávio · 15/10/2026 14:30");
    // O título não se repete no corpo.
    expect(html.match(/GitHub: como manter/g)).toHaveLength(1);
  });
});
