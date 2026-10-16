// Cabeçalho das telas de página (Integrações, Biblioteca, Membros...): rótulo mono acima, título grande e as ações à
// direita, no padrão do Ownly e da Cifra.
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
        {eyebrow && <span className="hub-eyebrow mb-3">{eyebrow}</span>}
        <h1 className="font-heading text-[1.75rem] leading-[1.1] text-balance md:text-[2rem]">{title}</h1>
        {description && <p className="mt-2 max-w-[68ch] text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{children}</div>}
    </header>
  );
}
