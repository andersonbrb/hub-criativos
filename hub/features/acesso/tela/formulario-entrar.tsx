"use client";

import { useState } from "react";
import { ArrowRight, Loader2, LockKeyhole, Mail } from "lucide-react";

import { AvisoDeErro, Campo, CampoComIcone } from "@/features/acesso/tela/cartao";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/generations";

// Formulário de login. Com JavaScript manda JSON e mostra o erro na hora; sem JavaScript o mesmo formulário
// posta direto na API, que volta para /entrar com a mensagem.
export function FormularioEntrar({ proximo, erro, email }: { proximo: string; erro: string | null; email: string }) {
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState(erro);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setEnviando(true);
    setMensagem(null);
    try {
      const r = await apiFetch<{ proximo: string }>("/api/acesso/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), senha: form.get("senha"), proximo }),
      });
      // Navegação completa: o layout precisa ser montado de novo, agora com o menu da pessoa.
      window.location.assign(r.proximo);
    } catch (err) {
      setMensagem(err instanceof Error ? err.message : "Não deu para entrar. Tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <form method="post" action="/api/acesso/entrar" onSubmit={enviar} className="grid gap-4">
      <input type="hidden" name="proximo" value={proximo} />
      <Campo rotulo="E-mail" id="email">
        <CampoComIcone icone={Mail} id="email" name="email" type="email" autoComplete="email" placeholder="voce@empresa.com" defaultValue={email} required autoFocus={!email} />
      </Campo>
      <Campo rotulo="Senha" id="senha">
        <CampoComIcone icone={LockKeyhole} id="senha" name="senha" type="password" autoComplete="current-password" placeholder="Digite sua senha" required autoFocus={Boolean(email)} />
      </Campo>
      {mensagem && <AvisoDeErro>{mensagem}</AvisoDeErro>}
      <Button type="submit" size="lg" disabled={enviando} className="group/entrar mt-1 h-[2.875rem] w-full bg-rec text-[0.9375rem] font-semibold text-white hover:bg-rec/90">
        {enviando ? (
          <>
            <Loader2 className="animate-spin" />
            Entrando…
          </>
        ) : (
          <>
            Entrar
            <ArrowRight className="transition-transform duration-300 group-hover/entrar:translate-x-1" />
          </>
        )}
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">Esqueceu a senha ou ainda não tem conta? Fale com um admin do hub.</p>
    </form>
  );
}
