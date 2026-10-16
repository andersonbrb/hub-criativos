"use client";

import { useState } from "react";
import { ArrowRight, Loader2, LockKeyhole, UserRound } from "lucide-react";

import { SENHA_MINIMA } from "@/features/acesso/contrato";
import { AvisoDeErro, Campo, CampoComIcone } from "@/features/acesso/tela/cartao";
import { Button } from "@/components/ui/button";
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
        <CampoComIcone icone={UserRound} id="nome" name="nome" autoComplete="name" placeholder="Seu nome" defaultValue={nomeSugerido} required maxLength={100} autoFocus />
      </Campo>
      <Campo rotulo="Senha" id="senha" dica={`Pelo menos ${SENHA_MINIMA} caracteres. Uma frase curta é mais fácil de lembrar e mais difícil de adivinhar.`}>
        <CampoComIcone icone={LockKeyhole} id="senha" name="senha" type="password" autoComplete="new-password" required minLength={SENHA_MINIMA} maxLength={200} />
      </Campo>
      <Campo rotulo="Confirme a senha" id="confirmacao">
        <CampoComIcone icone={LockKeyhole} id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" placeholder="Repita a senha" required minLength={SENHA_MINIMA} maxLength={200} />
      </Campo>
      {mensagem && <AvisoDeErro>{mensagem}</AvisoDeErro>}
      <Button type="submit" size="lg" disabled={enviando} className="group/entrar mt-1 h-[2.875rem] w-full bg-rec text-[0.9375rem] font-semibold text-white hover:bg-rec/90">
        {enviando ? <Loader2 className="animate-spin" /> : null}
        Criar conta e entrar
        {!enviando && <ArrowRight className="transition-transform duration-300 group-hover/entrar:translate-x-1" />}
      </Button>
    </form>
  );
}
