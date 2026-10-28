"use client";

import { Ban, KeyRound, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { COLUNA_DE_ACOES, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NOME_MAXIMO, NOME_MINIMO, type ChaveNaTela } from "@/features/api/contrato";
import { BotaoCopiar } from "@/features/conector/tela/botao-copiar";
import { apiFetch } from "@/lib/generations";
import { cn } from "@/lib/utils";

// Tela "Chaves de API" (só dono ou admin): criar uma chave com nome, ver quando foi criada e usada, e revogar.
// A chave inteira aparece uma vez, na janela logo depois de criar; depois só o começo dela.

// Fuso fixo: o servidor e o navegador formatam igual e a equipe trabalha no horário de Brasília.
const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "—";

export function ChavesDeApi({ chavesIniciais, chaveFixaDoSkala }: { chavesIniciais: ChaveNaTela[]; chaveFixaDoSkala: boolean }) {
  const [chaves, setChaves] = useState(chavesIniciais);
  const [criarAberto, setCriarAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [nova, setNova] = useState<{ chave: string; nome: string } | null>(null);
  const [paraRevogar, setParaRevogar] = useState<ChaveNaTela | null>(null);
  const [revogando, setRevogando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setCriando(true);
    try {
      const { chave, registro } = await apiFetch<{ chave: string; registro: ChaveNaTela }>("/api/chaves-de-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      setChaves((atual) => [registro, ...atual]);
      setCriarAberto(false);
      setNome("");
      setNova({ chave, nome: registro.nome });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para criar a chave.");
    } finally {
      setCriando(false);
    }
  }

  async function revogar() {
    if (!paraRevogar) return;
    setRevogando(true);
    try {
      await apiFetch(`/api/chaves-de-api/${encodeURIComponent(paraRevogar.id)}`, { method: "DELETE" });
      const agora = new Date().toISOString();
      setChaves((atual) => atual.map((c) => (c.id === paraRevogar.id ? { ...c, revogadaEm: agora } : c)));
      toast.success(`Chave "${paraRevogar.nome}" revogada. Ela não entra mais.`);
      setParaRevogar(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para revogar.");
    } finally {
      setRevogando(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" aria-hidden />
              Chaves desta organização
            </CardTitle>
            <CardDescription className="mt-1">
              A chave inteira aparece uma vez só, na hora de criar. Revogar vale na hora. O que um sistema manda com a chave entra nesta organização.
            </CardDescription>
          </div>
          <Button onClick={() => setCriarAberto(true)}>
            <Plus />
            Criar chave
          </Button>
        </CardHeader>
        <CardContent>
          {chaves.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma chave ainda. Crie uma para ligar outro sistema ao hub.</p>
          ) : (
            <Table empilhar>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Começo da chave</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead>Criada</TableHead>
                  <TableHead className={COLUNA_DE_ACOES}>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chaves.map((c) => (
                  <TableRow key={c.id} className={cn("group/linha", c.revogadaEm && "text-muted-foreground")}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell data-rotulo="Começo da chave">
                      <code className="font-mono text-xs">{c.comeco}…</code>
                    </TableCell>
                    <TableCell data-rotulo="Situação">
                      {c.revogadaEm ? (
                        <Badge variant="destructive">Revogada em {dataHora(c.revogadaEm)}</Badge>
                      ) : (
                        <Badge variant="secondary">Ativa</Badge>
                      )}
                    </TableCell>
                    <TableCell data-rotulo="Último uso">{c.ultimoUsoEm ? dataHora(c.ultimoUsoEm) : "Nunca usada"}</TableCell>
                    <TableCell data-rotulo="Criada">
                      {dataHora(c.criadaEm)}
                      {c.criadaPor && <span className="block text-xs text-muted-foreground">por {c.criadaPor}</span>}
                    </TableCell>
                    <TableCell className={COLUNA_DE_ACOES}>
                      {!c.revogadaEm && (
                        <Button variant="outline" size="sm" onClick={() => setParaRevogar(c)}>
                          <Ban />
                          Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {chaveFixaDoSkala && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Além destas, continua valendo a chave fixa do Skala, guardada no servidor do hub (variável HUB_CHAVE_DO_SKALA, no Railway). Quando o Skala passar
              a usar uma chave desta lista, ela pode ser apagada de lá.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={criarAberto} onOpenChange={(aberto) => !criando && setCriarAberto(aberto)}>
        <DialogContent>
          <form onSubmit={criar} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Criar chave de API</DialogTitle>
              <DialogDescription>Dê um nome que diga onde a chave vai ser usada. Ele aparece na lista, para você saber qual revogar.</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Nome
              <Input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Skala — produção"
                minLength={NOME_MINIMO}
                maxLength={NOME_MAXIMO}
                required
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={criando} onClick={() => setCriarAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={criando || nome.trim().length < NOME_MINIMO}>
                {criando && <Loader2 className="animate-spin" />}
                Criar chave
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={nova !== null} onOpenChange={(aberto) => !aberto && setNova(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave &quot;{nova?.nome}&quot; criada</DialogTitle>
            <DialogDescription>Copie agora e guarde no outro sistema. Depois de fechar esta janela, ela não aparece de novo.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <code className="min-w-0 flex-1 border bg-muted px-3 py-2 font-mono text-xs break-all select-all">{nova?.chave}</code>
            <BotaoCopiar valor={nova?.chave ?? ""} />
          </div>
          <DialogFooter>
            <Button onClick={() => setNova(null)}>Já copiei</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paraRevogar !== null} onOpenChange={(aberto) => !aberto && !revogando && setParaRevogar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar a chave &quot;{paraRevogar?.nome}&quot;?</DialogTitle>
            <DialogDescription>
              O sistema que usa esta chave perde o acesso na hora. Não dá para desfazer: para ligar de novo, crie outra chave e troque lá.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={revogando} onClick={() => setParaRevogar(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={revogando} onClick={revogar}>
              {revogando && <Loader2 className="animate-spin" />}
              Revogar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
