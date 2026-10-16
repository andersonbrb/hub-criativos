"use client";

import { useState } from "react";
import { ArrowRight, Loader2, LockKeyhole, UserRound } from "lucide-react";

import { SENHA_MINIMA } from "@/features/acesso/contrato";
import { AvisoDeErro, Campo, CampoComIcone } from "@/features/acesso/tela/cartao";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/generations";

// Aceite do convite: a pessoa escolhe nome e senha, a conta nasce e ela já entra. Quem já tem conta (de outra
// organização) só confirma com a senha de sempre.
export function FormularioConvite({
  token,
  nomeSugerido,
  contaExiste = false,
  organizacao = "",
}: {
  token: string;
  nomeSugerido: string;
  contaExiste?: boolean;
  organizacao?: string;
}) {
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const senha = String(form.get("senha") ?? "");
    if (!contaExiste && senha.length < SENHA_MINIMA) return setMensagem(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    if (!contaExiste && senha !== form.get("confirmacao")) return setMensagem("As duas senhas não são iguais. Digite de novo.");
    if (contaExiste && !senha) return setMensagem("Digite a sua senha.");
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
      setMensagem(err instanceof Error ? err.message : "Não deu para aceitar o convite. Tente de novo.");
      setEnviando(false);
    }
  }

  if (contaExiste) {
    return (
      <form onSubmit={enviar} className="grid gap-4">
        <Campo rotulo="Sua senha do hub" id="senha" dica="A mesma que você usa para entrar. A sua conta não muda: ela só passa a participar desta organização também.">
          <CampoComIcone icone={LockKeyhole} id="senha" name="senha" type="password" autoComplete="current-password" required maxLength={200} autoFocus />
        </Campo>
        {mensagem && <AvisoDeErro>{mensagem}</AvisoDeErro>}
        <Button type="submit" size="lg" disabled={enviando} className="group/entrar mt-1 h-10 w-full bg-rec text-white hover:bg-rec/90">
          {enviando ? <Loader2 className="animate-spin" /> : null}
          Entrar em {organizacao}
          {!enviando && <ArrowRight className="transition-transform duration-300 group-hover/entrar:translate-x-1" />}
        </Button>
      </form>
    );
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
      <Button type="submit" size="lg" disabled={enviando} className="group/entrar mt-1 h-10 w-full bg-rec text-white hover:bg-rec/90">
        {enviando ? <Loader2 className="animate-spin" /> : null}
        Criar conta e entrar
        {!enviando && <ArrowRight className="transition-transform duration-300 group-hover/entrar:translate-x-1" />}
      </Button>
    </form>
  );
}
