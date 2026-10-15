"use client";

import { CHAVES_SEM_RESTRITAS, GRUPOS_DE_CHAVES, type Chave } from "@/features/acesso/contrato";

// Checkboxes das telas, agrupadas como no catálogo. "Marcar tudo" pula as restritas (administração e gasto), que
// só se ligam uma a uma; desmarcar tira tudo, restritas inclusive (tirar acesso nunca precisa ser difícil).
export function SeletorDeChaves({ valor, aoMudar, desabilitado = false }: { valor: Chave[]; aoMudar: (v: Chave[]) => void; desabilitado?: boolean }) {
  const tudoMarcado = CHAVES_SEM_RESTRITAS.every((c) => valor.includes(c));
  const alternar = (chave: Chave) => aoMudar(valor.includes(chave) ? valor.filter((c) => c !== chave) : [...valor, chave]);
  const alternarTudo = () => aoMudar(tudoMarcado ? [] : [...new Set([...valor, ...CHAVES_SEM_RESTRITAS])]);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Telas liberadas</span>
        <button type="button" onClick={alternarTudo} disabled={desabilitado} className="text-xs font-medium text-rec hover:underline disabled:opacity-50">
          {tudoMarcado ? "Desmarcar tudo" : "Marcar tudo"}
        </button>
      </div>
      <div className="max-h-[min(50vh,22rem)] divide-y overflow-y-auto overscroll-contain border">
        {GRUPOS_DE_CHAVES.map(({ grupo, chaves }) => (
          <fieldset key={grupo} className="grid gap-2 p-3">
            <legend className="sr-only">{grupo}</legend>
            <p aria-hidden className="font-mono text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
              {grupo}
            </p>
            {chaves.map((c) => (
              <label key={c.chave} className="flex cursor-pointer items-start gap-2.5 text-sm select-none">
                <input
                  type="checkbox"
                  checked={valor.includes(c.chave)}
                  onChange={() => alternar(c.chave)}
                  disabled={desabilitado}
                  className="mt-0.5 size-4 shrink-0 accent-rec"
                />
                <span>
                  {c.rotulo}
                  {"restrita" in c && c.restrita && <span className="ml-1.5 text-xs text-muted-foreground">(só marcando)</span>}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
