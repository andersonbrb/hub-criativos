"use client";

import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";

import { SENHA_MINIMA } from "@/features/acesso/contrato";
import { AvisoDeErro, Campo } from "@/features/acesso/tela/cartao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/generations";

// Aceite do convite: a pessoa escolhe nome e senha, a conta nasce e ela já entra.
export function FormularioConvite({ token, nomeSugerido }: { token: string; nomeSugerido: string }) {
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const senha = String(form.get("senha") ?? "");
    if (senha.length < SENHA_MINIMA) return setMensagem(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    if (senha !== form.get("confirmacao")) return setMensagem("As duas senhas não são iguais. Digite de novo.");
    setEnviando(true);
    setMensagem(null);
    try {
      const r = await apiFetch<{ proximo: string }>(`/api/acesso/convite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: form.get("nome"), senha }),
      });
      window.location.assign(r.proximo);
    } catch (err) {
      setMensagem(err instanceof Error ? err.message : "Não deu para criar a conta. Tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="grid gap-4">
      <Campo rotulo="Seu nome" id="nome">
        <Input id="nome" name="nome" autoComplete="name" defaultValue={nomeSugerido} required maxLength={100} autoFocus className="h-9" />
      </Campo>
      <Campo rotulo="Senha" id="senha" dica={`Pelo menos ${SENHA_MINIMA} caracteres. Uma frase curta é mais fácil de lembrar e mais difícil de adivinhar.`}>
        <Input id="senha" name="senha" type="password" autoComplete="new-password" required minLength={SENHA_MINIMA} maxLength={200} className="h-9" />
      </Campo>
      <Campo rotulo="Confirme a senha" id="confirmacao">
        <Input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" required minLength={SENHA_MINIMA} maxLength={200} className="h-9" />
      </Campo>
      {mensagem && <AvisoDeErro>{mensagem}</AvisoDeErro>}
      <Button type="submit" size="lg" disabled={enviando} className="bg-rec text-white hover:bg-rec/85">
        {enviando ? <Loader2 className="animate-spin" /> : <UserPlus />}
        Criar conta e entrar
      </Button>
    </form>
  );
}
