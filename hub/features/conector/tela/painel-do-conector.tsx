"use client";

import { Laptop, Loader2, Plug, ScrollText, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NOME_NO_CLAUDE_CODE, TEXTO_DE_MIGRACAO, comandoClaudeCode, type ConexaoNaTela } from "@/features/conector/contrato";
import { BotaoCopiar } from "@/features/conector/tela/botao-copiar";

// Tela "Conector do Claude Code": como ligar o Claude Code da pessoa ao Hub, o texto pronto para trocar a pasta de
// contexto local pelo Hub, e as conexões que já estão ligadas (com Desconectar).
//
// Escrita para quem não programa: cada passo diz o que fazer e onde clicar, sem termo técnico além do que a pessoa
// vai ver na tela do próprio Claude Code.

// Fuso fixo: o servidor e o navegador formatam igual (sem diferença de hidratação) e a equipe trabalha no horário de
// Brasília.
const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "—";

function Passo({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center bg-rec font-mono text-xs font-semibold text-white">{numero}</span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5 leading-relaxed">{children}</div>
    </li>
  );
}

function Codigo({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <code className="min-w-0 flex-1 border bg-muted px-3 py-2 font-mono text-xs break-all select-all">{texto}</code>
      <BotaoCopiar valor={texto} />
    </div>
  );
}

export function PainelDoConector({ endereco, conexoesIniciais }: { endereco: string; conexoesIniciais: ConexaoNaTela[] }) {
  const [conexoes, setConexoes] = useState(conexoesIniciais);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);

  const tirarDaLista = (id: string) => setConexoes((atual) => atual.filter((c) => c.id !== id));

  const desconectar = async (id: string) => {
    setRemovendo(id);
    try {
      const res = await fetch(`/api/conector/conexoes/${encodeURIComponent(id)}`, { method: "DELETE" });
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        tirarDaLista(id);
        toast.success("Desconectado. Esse Claude vai pedir para conectar de novo.");
      } else if (res.status === 404) {
        tirarDaLista(id);
        toast.success("Essa conexão já tinha sido desconectada.");
      } else {
        toast.error(dados.error ?? "Não deu para desconectar agora. Tente de novo.");
      }
    } catch {
      toast.error("Não deu para falar com o Hub agora. Confira a internet e tente de novo.");
    } finally {
      setRemovendo(null);
      setConfirmando(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Laptop className="size-4" /> Como ligar o seu Claude Code
          </CardTitle>
          <CardDescription>Leva dois minutos e é feito uma vez só em cada computador.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="max-w-3xl space-y-5 text-sm">
            <Passo numero={1}>
              <p>
                Abra o terminal. No Windows: aperte a tecla <strong>Windows</strong>, digite <strong>PowerShell</strong> e abra. Copie o
                comando abaixo, cole no terminal (botão direito do mouse) e aperte <strong>Enter</strong>.
              </p>
              <Codigo texto={comandoClaudeCode(endereco)} />
              <p className="text-xs text-muted-foreground">Se aparecer que o {NOME_NO_CLAUDE_CODE} já existe, está tudo certo: siga para o passo 2.</p>
            </Passo>
            <Passo numero={2}>
              <p>
                Abra o Claude Code (se já estava aberto, feche e abra de novo), digite <strong>/mcp</strong> e aperte <strong>Enter</strong>.
                Escolha <strong>{NOME_NO_CLAUDE_CODE}</strong> e depois <strong>Authenticate</strong>.
              </p>
              <p>
                O navegador abre numa página do Hub. Confira que é a sua conta, marque <strong>Fui eu que pedi agora</strong> e clique em{" "}
                <strong>Autorizar</strong>. Pronto: volte ao Claude Code. A conexão aparece na lista lá embaixo.
              </p>
            </Passo>
          </ol>
          <p className="mt-5 max-w-3xl text-xs text-muted-foreground">
            No Claude do site ou do aplicativo: Configurações, Conectores, Adicionar conector personalizado, e cole este endereço:{" "}
            <code className="font-mono break-all">{endereco}</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-4" /> Texto para mudar o seu Claude Code para o Hub
          </CardTitle>
          <CardDescription>
            Depois de ligar o conector, cole este texto no Claude Code. Ele procura no seu computador as memórias que ainda não estão no
            Hub, sobe sem chaves nem senhas e passa a usar o Hub no lugar da pasta de contexto. No fim, mostra o que subiu e o que ficou de
            fora.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <pre className="max-h-72 overflow-auto border bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{TEXTO_DE_MIGRACAO}</pre>
          <BotaoCopiar valor={TEXTO_DE_MIGRACAO} rotulo="Copiar o texto" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4" /> Suas conexões
          </CardTitle>
          <CardDescription>
            Cada Claude que você autorizou. Desconectar corta na hora; aquele Claude pede para conectar de novo. Conexão parada por 60 dias
            se desliga sozinha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {conexoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum Claude conectado ainda. Siga os dois passos acima.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="py-2 pr-3 font-medium">Aplicativo</th>
                    <th className="py-2 pr-3 font-medium">Conectado em</th>
                    <th className="py-2 pr-3 font-medium">Último uso</th>
                    <th className="py-2 pr-3 font-medium">IP</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {conexoes.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{c.app}</span>
                        {c.clienteNome !== c.app && <span className="block text-xs text-muted-foreground">{c.clienteNome}</span>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{dataHora(c.criadoEm)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{dataHora(c.ultimoUsoEm)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{c.ip ?? "—"}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {confirmando === c.id ? (
                          <span className="inline-flex gap-1.5">
                            <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)} disabled={removendo === c.id}>
                              Cancelar
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => desconectar(c.id)} disabled={removendo === c.id}>
                              {removendo === c.id ? <Loader2 className="animate-spin" /> : <Unplug />}
                              Confirmar
                            </Button>
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setConfirmando(c.id)} disabled={!!removendo}>
                            <Unplug /> Desconectar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
