"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Botão Copiar com o "Copiado" de volta por dois segundos.
export function BotaoCopiar({ valor, rotulo = "Copiar" }: { valor: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // A área de transferência só funciona em página segura (https ou localhost); fora dela, resta copiar à mão.
      toast.error("Não deu para copiar. Selecione o texto e copie à mão.");
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={copiar} disabled={!valor} className="shrink-0">
      {copiado ? <Check /> : <Copy />}
      {copiado ? "Copiado" : rotulo}
    </Button>
  );
}
