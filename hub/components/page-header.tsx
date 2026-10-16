// Cabeçalho das telas de página (Integrações, Biblioteca, Membros...): seção em cinza acima, título e as ações à
// direita, no estilo do ElevenLabs.
export function PageHeader({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  eyebrow?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && <span className="hub-eyebrow mb-1.5">{eyebrow}</span>}
        <h1 className="font-heading text-2xl leading-tight text-balance md:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{children}</div>}
    </header>
  );
}
