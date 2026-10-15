"use client";

import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";

import { AvisoDeErro, Campo } from "@/features/acesso/tela/cartao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={email} required autoFocus={!email} className="h-9" />
      </Campo>
      <Campo rotulo="Senha" id="senha">
        <Input id="senha" name="senha" type="password" autoComplete="current-password" required autoFocus={Boolean(email)} className="h-9" />
      </Campo>
      {mensagem && <AvisoDeErro>{mensagem}</AvisoDeErro>}
      <Button type="submit" size="lg" disabled={enviando} className="bg-rec text-white hover:bg-rec/85">
        {enviando ? <Loader2 className="animate-spin" /> : <LogIn />}
        Entrar
      </Button>
      <p className="text-xs text-muted-foreground">Esqueceu a senha ou ainda não tem conta? Fale com um admin do hub.</p>
    </form>
  );
}
