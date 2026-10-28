import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { BotaoCopiar } from "@/features/conector/tela/botao-copiar";

// Tela "Documentação da API": o texto de features/api/documentacao.ts com um índice das seções ao lado e um botão
// Copiar em cada exemplo. Sem estado: renderiza no servidor (só o botão Copiar roda no navegador).

const ancora = (texto: string) =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const textoDe = (filhos: React.ReactNode): string =>
  typeof filhos === "string" || typeof filhos === "number"
    ? String(filhos)
    : Array.isArray(filhos)
      ? filhos.map(textoDe).join("")
      : filhos && typeof filhos === "object" && "props" in filhos
        ? textoDe((filhos as { props: { children?: React.ReactNode } }).props.children)
        : "";

const componentes: Components = {
  h1: ({ children }) => <h1 className="font-heading text-2xl leading-tight md:text-[1.75rem]">{children}</h1>,
  h2: ({ children }) => (
    <h2 id={ancora(textoDe(children))} className="mt-10 scroll-mt-20 border-t pt-6 font-heading text-xl leading-tight">
      {children}
    </h2>
  ),
  h3: ({ children }) => <h3 className="mt-6 font-heading text-base font-semibold">{children}</h3>,
  p: ({ children }) => <p className="mt-3 leading-relaxed text-foreground/85">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-[square] space-y-1.5 pl-5 text-foreground/85 marker:text-rec">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1.5 pl-6 text-foreground/85 marker:text-rec">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="font-medium text-rec underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? <code className={className}>{children}</code> : <code className="border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>,
  pre: ({ children }) => {
    const texto = textoDe(children).replace(/^\n+|\n+$/g, "");
    return (
      <div className="mt-3 border bg-muted/40">
        <div className="flex justify-end border-b px-2 py-1.5">
          <BotaoCopiar valor={texto} />
        </div>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed">{texto}</pre>
      </div>
    );
  },
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60 text-left">{children}</thead>,
  th: ({ children }) => <th className="border-b px-3 py-2 font-semibold whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2 align-top text-foreground/85">{children}</td>,
};

export function DocumentacaoDaApi({ texto }: { texto: string }) {
  const secoes = [...texto.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <article className="min-w-0 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentes}>
          {texto}
        </ReactMarkdown>
      </article>
      <nav aria-label="Seções da documentação" className="order-first lg:order-none">
        <div className="lg:sticky lg:top-6">
          <p className="hub-eyebrow mb-2">Nesta página</p>
          <ul className="space-y-1 text-sm">
            {secoes.map((s) => (
              <li key={s}>
                <a href={`#${ancora(s)}`} className="text-muted-foreground hover:text-foreground">
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}
