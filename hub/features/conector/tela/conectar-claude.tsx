"use client";

import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PedidoNaTela } from "@/features/conector/contrato";

// Autorizar o Claude: a tela que o Claude abre no navegador no meio do login.
//
// O cuidado da tela é um só: ninguém deve autorizar um pedido que não fez. Um link destes pode chegar por mensagem,
// de outra pessoa, e autorizar daria a um Claude alheio a memória e os arquivos do Hub. Por isso o destino aparece
// em destaque e o botão só libera depois de a pessoa marcar que foi ela.
//
// E o navegador pode estar na conta de OUTRA pessoa: "Entrar com outra conta" sai e volta para esta mesma tela, com
// o mesmo pedido (ele vive no banco por 10 minutos, não na sessão).

// Quanto esperar o navegador sair da página depois de responder antes de mostrar "Pronto": o app do Claude no
// computador pode abrir por fora e deixar esta aba parada aqui.
const ESPERA_SAIDA_MS = 4000;

type Erro = { texto: string; icone: "vencido" | "usado" | "barrado" | "falha" };

const paraEntrar = (voltarPara: string) => `/entrar?proximo=${encodeURIComponent(voltarPara)}`;

export function ConectarClaude({ pedido, voltarPara }: { pedido: PedidoNaTela; voltarPara: string }) {
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState<"autorizar" | "recusar" | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [erro, setErro] = useState<Erro | null>(
    pedido.estado === "pronto" ? null : { texto: pedido.mensagem, icone: pedido.estado === "usado" ? "usado" : "vencido" },
  );
  const [saida, setSaida] = useState<"autorizado" | "recusado" | null>(null);
  const [demorou, setDemorou] = useState(false);
  // O estado do React só muda no próximo desenho; um clique duplo rápido passaria pelos dois. A trava fecha no
  // primeiro clique e fica fechada depois de responder: o pedido já foi decidido.
  const travado = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Sai da conta atual e vai para o login já sabendo voltar para cá. Não responde o pedido: o Claude segue esperando.
  const trocarConta = async () => {
    if (trocando || saida) return;
    setTrocando(true);
    setErroAcao(null);
    let destino = paraEntrar(voltarPara);
    try {
      const res = await fetch("/api/acesso/sair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proximo: voltarPara }),
      });
      if (!res.ok) throw new Error();
      const dados = (await res.json().catch(() => ({}))) as { destino?: string };
      if (typeof dados.destino === "string" && dados.destino.startsWith("/entrar")) destino = dados.destino;
    } catch {
      // Sem sair de verdade, o login devolveria a pessoa para cá com a mesma conta: um laço.
      setErroAcao("Não deu para sair desta conta agora. Confira a internet e tente de novo.");
      setTrocando(false);
      return;
    }
    // Recarga inteira, não navegação interna: a moldura do hub ainda tem a pessoa antiga em memória.
    window.location.assign(destino);
  };

  const responder = async (tipo: "autorizar" | "recusar") => {
    if (pedido.estado !== "pronto" || travado.current) return;
    travado.current = true;
    setEnviando(tipo);
    setErroAcao(null);
    try {
      const res = await fetch(`/api/conector/pedidos/${encodeURIComponent(pedido.pedidoId)}/${tipo}`, { method: "POST" });
      const dados = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (res.status === 401) {
        // A sessão caiu no meio do caminho: entra de novo e volta para o mesmo pedido.
        window.location.assign(paraEntrar(voltarPara));
        return;
      }
      if (res.status === 403) {
        setErro({ texto: dados.error ?? "Sua conta não tem acesso ao Conector do Claude Code. Peça a um admin.", icone: "barrado" });
        return;
      }
      if (res.status === 404 || res.status === 409) {
        setErro({ texto: dados.error ?? "Este pedido de conexão não vale mais.", icone: res.status === 409 ? "usado" : "vencido" });
        return;
      }
      if (!res.ok || typeof dados.redirect !== "string" || !dados.redirect) {
        setErroAcao(dados.error ?? "Não deu para concluir agora. Tente de novo em instantes.");
        travado.current = false;
        setEnviando(null);
        return;
      }
      setSaida(tipo === "autorizar" ? "autorizado" : "recusado");
      timer.current = setTimeout(() => setDemorou(true), ESPERA_SAIDA_MS);
      window.location.assign(dados.redirect);
    } catch {
      setErroAcao("Não deu para falar com o Hub agora. Confira a internet e tente de novo.");
      travado.current = false;
      setEnviando(null);
    }
  };

  return (
    <Card className="w-full max-w-md gap-0 py-0">
      <CardContent className="p-5 sm:p-6">
        {erro ? (
          <EstadoErro erro={erro} trocando={trocando} erroAcao={erroAcao} onTrocarConta={trocarConta} />
        ) : saida ? (
          <EstadoSaida saida={saida} demorou={demorou} app={pedido.estado === "pronto" ? pedido.app : "Claude"} />
        ) : pedido.estado === "pronto" ? (
          <div className="space-y-5">
            <h1 className="font-heading text-lg leading-snug font-semibold tracking-tight">
              O <strong className="font-extrabold">{pedido.app}</strong> quer usar o Hub de Criativos com a sua conta
            </h1>

            <dl className="space-y-4 text-sm">
              <div>
                <dt className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Em nome de</dt>
                <dd className="mt-1">
                  <span className="block font-medium">{pedido.pessoa.nome || pedido.pessoa.email}</span>
                  {pedido.pessoa.nome && <span className="block text-muted-foreground">{pedido.pessoa.email}</span>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Não é você?{" "}
                    <button
                      type="button"
                      onClick={trocarConta}
                      disabled={trocando || !!enviando}
                      className="font-semibold underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    >
                      {trocando ? "Saindo…" : "Entrar com outra conta"}
                    </button>
                  </p>
                </dd>
              </div>

              <div>
                <dt className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">O que ele vai poder fazer</dt>
                <dd className="mt-1 leading-relaxed">
                  Ler e gravar na memória do Hub, usar a Biblioteca e o Fluxo, sempre com as permissões que a sua conta já tem. Tudo
                  o que ele gravar fica com o seu nome.
                </dd>
              </div>

              <div>
                <dt className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Para onde volta</dt>
                <dd className="mt-1">
                  <span className="block border border-rec/50 bg-rec/10 px-3 py-2 font-mono text-base font-semibold break-all">
                    {pedido.destinoHost || "—"}
                  </span>
                  {pedido.destinoLocal && (
                    <span className="mt-1 block text-xs text-muted-foreground">É o Claude Code neste computador.</span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="flex items-start gap-2 border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1 leading-relaxed">
                Só autorize se foi você que acabou de pedir essa conexão no Claude. Se este link chegou por mensagem de outra pessoa,
                autorizar entrega a ela o seu acesso ao Hub: recuse.
              </span>
            </div>

            <label htmlFor="conector-confirmacao" className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
              <input
                id="conector-confirmacao"
                type="checkbox"
                checked={confirmado}
                onChange={(e) => setConfirmado(e.target.checked)}
                disabled={!!enviando || trocando}
                className="size-4 accent-[var(--rec)]"
              />
              Fui eu que pedi agora
            </label>

            {erroAcao && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">{erroAcao}</span>
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" size="lg" onClick={() => responder("recusar")} disabled={!!enviando || trocando} className="sm:min-w-28">
                {enviando === "recusar" && <Loader2 className="animate-spin" />}
                Recusar
              </Button>
              <Button size="lg" onClick={() => responder("autorizar")} disabled={!confirmado || !!enviando || trocando} className="sm:min-w-32">
                {enviando === "autorizar" && <Loader2 className="animate-spin" />}
                {enviando === "autorizar" ? "Autorizando…" : "Autorizar"}
              </Button>
            </div>

            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              Dá para desconectar quando quiser, na tela Conector do Claude Code, dentro do Hub.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EstadoSaida({ saida, demorou, app }: { saida: "autorizado" | "recusado"; demorou: boolean; app: string }) {
  if (!demorou) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Voltando para o {app}…
      </div>
    );
  }
  const autorizado = saida === "autorizado";
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      {autorizado ? <CheckCircle2 className="size-10 text-ok" /> : <XCircle className="size-10 text-muted-foreground" />}
      <p className="font-heading text-lg font-semibold">{autorizado ? "Pronto. Pode voltar ao Claude." : "Conexão recusada."}</p>
      <p className="text-sm text-muted-foreground">
        {autorizado ? "Esta página já pode ser fechada." : "Nada foi liberado. Esta página já pode ser fechada."}
      </p>
    </div>
  );
}

function EstadoErro({ erro, trocando, erroAcao, onTrocarConta }: { erro: Erro; trocando: boolean; erroAcao: string | null; onTrocarConta: () => void }) {
  const Icone = { vencido: Clock, usado: CheckCircle2, barrado: ShieldAlert, falha: AlertTriangle }[erro.icone];
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Icone className={erro.icone === "barrado" || erro.icone === "falha" ? "size-10 text-destructive" : "size-10 text-muted-foreground"} />
      <p className="text-sm leading-relaxed">{erro.texto}</p>
      {/* Sem acesso também precisa de saída: a conta aberta no navegador pode ser de outra pessoa. */}
      {erro.icone === "barrado" && (
        <>
          <p className="text-sm text-muted-foreground">Se a conta certa é outra, entre com ela.</p>
          <Button variant="outline" onClick={onTrocarConta} disabled={trocando}>
            {trocando && <Loader2 className="animate-spin" />}
            {trocando ? "Saindo…" : "Entrar com outra conta"}
          </Button>
        </>
      )}
      {erroAcao && (
        <p className="flex items-start gap-2 text-left text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{erroAcao}</span>
        </p>
      )}
    </div>
  );
}
