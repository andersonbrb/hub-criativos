"use client";

import { Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAVES, MODELO_PADRAO, MODELOS_DA_API, type NomeDaChave, type ResumoDaChave } from "@/features/integracoes/contrato";
import { apiFetch } from "@/lib/generations";

// Campos da tela Integrações para colar as chaves das integrações (no lugar das variáveis do servidor).
// A chave salva nunca volta inteira para a tela: só os 4 últimos caracteres.

const endereco = (nome: NomeDaChave) => `/api/integracoes/chaves/${nome}`;

type Props = {
  nome: NomeDaChave;
  resumo: ResumoDaChave;
  // Onde a pessoa pega a chave (link e texto curto).
  ajuda?: { texto: string; href: string };
  exemplo?: string;
};

export function CampoDeChave({ nome, resumo, ajuda, exemplo }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState(!resumo.salva);
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { rotulo, segredo } = CHAVES[nome];

  const salvar = async () => {
    setOcupado(true);
    try {
      await apiFetch(endereco(nome), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ valor }) });
      toast.success(`${rotulo}: salva.`);
      setValor("");
      setEditando(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para salvar agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!confirm(`Remover "${rotulo}" deste hub? O que usa essa chave para de funcionar até colar outra.`)) return;
    setOcupado(true);
    try {
      await apiFetch(endereco(nome), { method: "DELETE" });
      toast.success(`${rotulo}: removida.`);
      setEditando(true);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para remover agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  if (resumo.salva && !editando) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <KeyRound className="size-3.5 shrink-0 text-ok" />
          <span className="truncate">
            {rotulo}: <span className="font-mono">{resumo.mostra}</span>
          </span>
        </span>
        <span className="flex gap-1">
          <Button size="xs" variant="outline" disabled={ocupado} onClick={() => setEditando(true)}>
            Trocar
          </Button>
          <Button size="xs" variant="ghost" disabled={ocupado} onClick={remover} aria-label={`Remover ${rotulo}`}>
            {ocupado ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </span>
      </div>
    );
  }

  return (
    <form
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valor.trim()) void salvar();
      }}
    >
      <label htmlFor={`chave-${nome}`} className="text-xs font-medium">
        {rotulo}
      </label>
      <div className="flex gap-1.5">
        <Input
          id={`chave-${nome}`}
          type={segredo ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          placeholder={exemplo ?? "Cole aqui"}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="h-7 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={ocupado || !valor.trim()}>
          {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
          Salvar
        </Button>
        {resumo.salva && (
          <Button type="button" size="sm" variant="ghost" disabled={ocupado} onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        )}
      </div>
      {ajuda && (
        <p className="text-xs text-muted-foreground">
          Pegue em{" "}
          <a href={ajuda.href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {ajuda.texto}
          </a>
          .
        </p>
      )}
    </form>
  );
}

// Modelo do chat quando ele roda pela API da Anthropic (o hub da nuvem). Salva ao escolher.
export function SeletorDeModelo({ resumo }: { resumo: ResumoDaChave }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const atual = resumo.mostra ?? MODELO_PADRAO;

  const escolher = async (modelo: string) => {
    if (modelo === atual) return;
    setOcupado(true);
    try {
      await apiFetch(endereco("modelo-api"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ valor: modelo }) });
      toast.success("Modelo do chat trocado. Vale para as próximas mensagens.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para trocar agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="grid gap-1.5">
      <label htmlFor="modelo-api" className="text-xs font-medium">
        {CHAVES["modelo-api"].rotulo}
      </label>
      <Select value={atual} onValueChange={escolher} disabled={ocupado}>
        <SelectTrigger id="modelo-api" size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODELOS_DA_API.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
