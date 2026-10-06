import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown das respostas dos agentes, com hierarquia bem marcada no estilo do hub (Suíço):
// títulos com filete e marcador azul, subtítulos em azul, texto corrido um pouco mais suave para o negrito saltar,
// listas com marcadores/números em azul e mais respiro, tabelas com cabeçalho e linhas alternadas.
const components: Components = {
  p: ({ children }) => <p className="mb-3 leading-relaxed text-foreground/85 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-foreground/90 italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-3 list-[square] space-y-1.5 pl-5 text-foreground/85 marker:text-rec last:mb-0 [&_ol]:mt-1.5 [&_ul]:mt-1.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1.5 pl-6 text-foreground/85 marker:font-mono marker:text-[0.85em] marker:font-semibold marker:text-rec last:mb-0 [&_ol]:mt-1.5 [&_ul]:mt-1.5">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h3 className="mt-6 mb-3 border-t border-foreground/20 pt-3 font-heading text-lg text-foreground first:mt-0 first:border-t-0 first:pt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-6 mb-2.5 flex items-center gap-2 border-t border-border pt-3 font-heading text-base text-foreground first:mt-0 first:border-t-0 first:pt-0">
      <span className="size-2 shrink-0 bg-rec" aria-hidden />
      {children}
    </h3>
  ),
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-sm font-semibold tracking-wide text-rec uppercase first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">{children}</h5>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-rec underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
    ),
  pre: ({ children }) => <pre className="mb-3 overflow-x-auto border bg-muted p-3 font-mono text-xs leading-relaxed last:mb-0">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-rec bg-muted/60 py-2 pr-3 pl-3 text-foreground/80 last:mb-0 [&_p]:mb-1.5">{children}</blockquote>
  ),
  hr: () => <hr className="my-5 border-dashed border-border" />,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto border last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  tr: ({ children }) => <tr className="border-b last:border-b-0 even:bg-muted/40">{children}</tr>,
  th: ({ children }) => <th className="px-2.5 py-1.5 text-left text-[0.6875rem] font-semibold tracking-wide text-foreground uppercase">{children}</th>,
  td: ({ children }) => <td className="px-2.5 py-1.5 align-top text-foreground/85">{children}</td>,
};

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
