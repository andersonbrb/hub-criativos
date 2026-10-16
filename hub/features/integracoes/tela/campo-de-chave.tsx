"use client";

import { Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAVES, MODELO_PADRAO, MODELOS_DA_API, type NomeDaChave, type ResumoDaChave } from "@/features/integracoes/contrato";
import { CaixaDeStatus } from "@/features/integracoes/tela/cartao";
import { apiFetch } from "@/lib/generations";

// Campos da tela Integrações para colar as chaves das integrações (no lugar das variáveis do servidor).
// A chave salva nunca volta inteira para a tela: só os 4 últimos caracteres.

const endereco = (nome: NomeDaChave) => `/api/integracoes/chaves/${nome}`;

type Props = {
  nome: NomeDaChave;
  resumo: ResumoDaChave;
  // Nome curto dentro do cartão ("Chave da API"); sem ele, o rótulo completo da chave.
  titulo?: string;
  exemplo?: string;
};

export function CampoDeChave({ nome, resumo, titulo, exemplo }: Props) {
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
      <CaixaDeStatus
        titulo={titulo ?? rotulo}
        detalhe={<span className="font-mono">{resumo.mostra}</span>}
        acoes={
          <>
            <Button size="sm" disabled={ocupado} onClick={() => setEditando(true)}>
              <KeyRound />
              Trocar
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={ocupado}
              onClick={remover}
              aria-label={`Remover ${rotulo}`}
              title="Remover"
            >
              {ocupado ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <form
      className="grid gap-2 rounded-xl border px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valor.trim()) void salvar();
      }}
    >
      <label htmlFor={`chave-${nome}`} className="text-sm font-medium">
        {titulo ?? rotulo}
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
          className="h-8 min-w-0 font-mono text-xs placeholder:font-sans"
        />
        <Button type="submit" size="sm" className="h-8" disabled={ocupado || !valor.trim()}>
          {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
          Salvar
        </Button>
        {resumo.salva && (
          <Button type="button" size="sm" variant="ghost" className="h-8" disabled={ocupado} onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        )}
      </div>
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
    <div className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2">
      <label htmlFor="modelo-api" className="text-sm font-medium">
        Modelo
      </label>
      <Select value={atual} onValueChange={escolher} disabled={ocupado}>
        <SelectTrigger id="modelo-api" size="sm" className="w-auto min-w-0">
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
