"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Power, PowerOff, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  CHAVES_SEM_RESTRITAS,
  ehAdmin,
  ROTULO_DO_PAPEL,
  TODAS_AS_CHAVES,
  type Chave,
  type ConvitePendente,
  type Membro,
  type Usuario,
} from "@/features/acesso/contrato";
import { Campo } from "@/features/acesso/tela/cartao";
import { SeletorDeChaves } from "@/features/acesso/tela/seletor-de-chaves";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/generations";

type PapelEditavel = "admin" | "membro";
type Mudancas = { papel?: PapelEditavel; chaves?: Chave[]; ativo?: boolean };

const JSON_HEADERS = { "Content-Type": "application/json" };
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca");
const erroDe = (err: unknown, padrao: string) => (err instanceof Error ? err.message : padrao);

// Membros e convites (modelo do Chegou Operações). As regras de quem pode o quê valem no servidor; aqui a tela só
// esconde o que não vai funcionar.
export function TelaDeMembros({ eu }: { eu: Usuario }) {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [convites, setConvites] = useState<ConvitePendente[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState<Membro | null>(null);
  const [convidando, setConvidando] = useState(false);

  const gestor = ehAdmin(eu);
  const souDono = eu.papel === "dono";
  // Admin cuida de membros; mexer em admin ou dono é com o dono.
  const podeMexer = (m: Membro) => gestor && (m.id === eu.id || m.papel === "membro" || souDono);

  const carregar = useCallback(
    () =>
      Promise.all([apiFetch<{ membros: Membro[] }>("/api/acesso/membros"), apiFetch<{ convites: ConvitePendente[] }>("/api/acesso/convites")])
        .then(([m, c]) => {
          setMembros(m.membros);
          setConvites(c.convites);
        })
        .catch((err) => toast.error(erroDe(err, "Não consegui carregar os membros.")))
        .finally(() => setCarregado(true)),
    [],
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function atualizar(m: Membro, mudancas: Mudancas, sucesso: string) {
    setOcupado(m.id);
    try {
      const r = await apiFetch<{ membro: Membro }>(`/api/acesso/membros/${m.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(mudancas) });
      setMembros((lista) => lista.map((x) => (x.id === m.id ? r.membro : x)));
      toast.success(sucesso);
      return true;
    } catch (err) {
      toast.error(erroDe(err, "Não deu para salvar."));
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function mudarPapel(m: Membro, papel: PapelEditavel) {
    const texto = papel === "admin" ? `Tornar ${m.nome} admin? Admins veem todas as telas e gerenciam membros.` : `Tirar ${m.nome} de admin? Passa a ver só as telas marcadas para ela.`;
    if (!confirm(texto)) return;
    await atualizar(m, { papel }, `${m.nome} agora é ${papel}.`);
  }

  async function alternarAtivo(m: Membro) {
    if (m.ativo && !confirm(`Desativar ${m.nome}? A pessoa sai do hub na hora e não consegue mais entrar.`)) return;
    await atualizar(m, { ativo: !m.ativo }, m.ativo ? `${m.nome} foi desativado.` : `${m.nome} foi reativado.`);
  }

  async function revogar(c: ConvitePendente) {
    if (!confirm(`Revogar o convite de ${c.email}? O link para de funcionar.`)) return;
    setOcupado(c.id);
    try {
      await apiFetch(`/api/acesso/convites/${c.id}`, { method: "DELETE" });
      setConvites((lista) => lista.filter((x) => x.id !== c.id));
      toast.success("Convite revogado.");
    } catch (err) {
      toast.error(erroDe(err, "Não deu para revogar."));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <main className="flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader title="Membros" description="Quem entra no hub e quais telas cada pessoa vê. Admins e o dono veem tudo e gerenciam a equipe.">
        {gestor && (
          <Button onClick={() => setConvidando(true)} className="bg-rec text-white hover:bg-rec/85">
            <UserPlus />
            Convidar
          </Button>
        )}
      </PageHeader>

      {!gestor && (
        <p className="border px-3 py-2 text-sm text-muted-foreground">Você pode ver a equipe, mas só admins e o dono mudam acessos e convidam pessoas.</p>
      )}

      {!carregado ? (
        <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <section className="grid gap-2">
            <h2 className="font-heading text-lg font-bold">
              Equipe <span className="font-mono text-sm font-normal text-muted-foreground tabular-nums">{membros.length}</span>
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Telas</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membros.map((m) => {
                  const proprio = m.id === eu.id;
                  const trocaPapel = souDono && !proprio && m.papel !== "dono";
                  return (
                    <TableRow key={m.id} className={m.ativo ? undefined : "text-muted-foreground"}>
                      <TableCell className="font-medium">
                        {m.nome}
                        {proprio && <span className="ml-1.5 text-xs text-muted-foreground">(você)</span>}
                        {!m.temSenha && <span className="ml-1.5 text-xs text-warn">sem senha</span>}
                      </TableCell>
                      <TableCell>{m.email}</TableCell>
                      <TableCell>
                        {trocaPapel ? (
                          <Select value={m.papel} onValueChange={(v) => mudarPapel(m, v as PapelEditavel)} disabled={ocupado === m.id}>
                            <SelectTrigger size="sm" aria-label={`Papel de ${m.nome}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="membro">Membro</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={m.papel === "membro" ? "outline" : "secondary"}>{ROTULO_DO_PAPEL[m.papel]}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {m.papel === "membro" ? `${m.chaves.length} de ${TODAS_AS_CHAVES.length}` : "Todas"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={m.ativo ? "bg-ok/15 text-ok" : "bg-muted text-muted-foreground"}>
                          {m.ativo ? "Ativo" : "Desativado"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{quando(m.ultimoAcessoEm)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {podeMexer(m) && m.papel === "membro" && (
                            <Button size="xs" variant="outline" onClick={() => setEditando(m)} disabled={ocupado === m.id}>
                              <KeyRound />
                              Telas
                            </Button>
                          )}
                          {podeMexer(m) && !proprio && (
                            <Button size="xs" variant={m.ativo ? "destructive" : "outline"} onClick={() => alternarAtivo(m)} disabled={ocupado === m.id}>
                              {ocupado === m.id ? <Loader2 className="animate-spin" /> : m.ativo ? <PowerOff /> : <Power />}
                              {m.ativo ? "Desativar" : "Reativar"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>

          <section className="grid gap-2">
            <h2 className="font-heading text-lg font-bold">
              Convites pendentes <span className="font-mono text-sm font-normal text-muted-foreground tabular-nums">{convites.length}</span>
            </h2>
            {convites.length === 0 ? (
              <p className="border border-dashed py-8 text-center text-sm text-muted-foreground">Nenhum convite esperando resposta.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Telas</TableHead>
                    <TableHead>Convidado por</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {convites.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        {c.email}
                        {c.nome && <span className="ml-1.5 text-xs text-muted-foreground">{c.nome}</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.papel === "membro" ? "outline" : "secondary"}>{ROTULO_DO_PAPEL[c.papel]}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{c.papel === "membro" ? `${c.chaves.length} de ${TODAS_AS_CHAVES.length}` : "Todas"}</TableCell>
                      <TableCell>{c.criadoPor ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {c.vencido ? (
                          <Badge variant="secondary" className="bg-warn/15 text-warn">
                            Vencido
                          </Badge>
                        ) : (
                          quando(c.expiraEm)
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {gestor && (
                            <Button size="xs" variant="outline" onClick={() => revogar(c)} disabled={ocupado === c.id}>
                              <Trash2 />
                              Revogar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-xs text-muted-foreground">O link do convite aparece uma vez só, ao criar. Perdeu o link? Convide de novo: o link antigo para de valer.</p>
          </section>
        </>
      )}

      {editando && (
        <EditarTelas
          membro={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={async (chaves) => {
            if (await atualizar(editando, { chaves }, `Telas de ${editando.nome} atualizadas.`)) setEditando(null);
          }}
        />
      )}
      {convidando && (
        <Convidar
          souDono={souDono}
          aoFechar={() => setConvidando(false)}
          aoCriar={(c) => setConvites((lista) => [c, ...lista.filter((x) => x.email !== c.email)])}
        />
      )}
    </main>
  );
}

function EditarTelas({ membro, aoFechar, aoSalvar }: { membro: Membro; aoFechar: () => void; aoSalvar: (chaves: Chave[]) => Promise<void> }) {
  const [chaves, setChaves] = useState<Chave[]>(membro.chaves);
  const [salvando, setSalvando] = useState(false);
  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Telas de {membro.nome}</DialogTitle>
          <DialogDescription>Marque o que essa pessoa pode abrir no hub. Vale na próxima tela que ela abrir.</DialogDescription>
        </DialogHeader>
        <SeletorDeChaves valor={chaves} aoMudar={setChaves} desabilitado={salvando} />
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            onClick={async () => {
              setSalvando(true);
              await aoSalvar(chaves);
              setSalvando(false);
            }}
            disabled={salvando}
          >
            {salvando && <Loader2 className="animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Convidar({ souDono, aoFechar, aoCriar }: { souDono: boolean; aoFechar: () => void; aoCriar: (c: ConvitePendente) => void }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState<PapelEditavel>("membro");
  const [chaves, setChaves] = useState<Chave[]>(CHAVES_SEM_RESTRITAS);
  const [enviando, setEnviando] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await apiFetch<{ link: string; convite: ConvitePendente }>("/api/acesso/convites", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, nome: nome || undefined, papel, chaves: papel === "membro" ? chaves : [] }),
      });
      setLink(`${window.location.origin}${r.link}`);
      aoCriar(r.convite);
    } catch (err) {
      toast.error(erroDe(err, "Não deu para criar o convite."));
    } finally {
      setEnviando(false);
    }
  }

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      toast.success("Link copiado. Mande para a pessoa pelo WhatsApp ou e-mail.");
    } catch {
      toast.error("Não consegui copiar. Selecione o link e copie à mão.");
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{link ? "Convite criado" : "Convidar pessoa"}</DialogTitle>
          <DialogDescription>
            {link
              ? "Copie o link e mande para a pessoa. Ele vale 7 dias, serve uma vez só e não aparece de novo."
              : "O hub não manda e-mail: ao criar, aparece um link para você copiar e mandar."}
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <>
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" className="font-mono text-xs" />
              <Button onClick={copiar} variant="outline">
                {copiado ? <Check /> : <Copy />}
                Copiar
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={aoFechar}>Fechar</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={enviar} className="grid gap-4">
            <Campo rotulo="E-mail" id="convite-email">
              <Input id="convite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Campo>
            <Campo rotulo="Nome (opcional)" id="convite-nome" dica="A pessoa pode trocar ao aceitar.">
              <Input id="convite-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
            </Campo>
            <Campo rotulo="Papel" id="convite-papel">
              <Select value={papel} onValueChange={(v) => setPapel(v as PapelEditavel)}>
                <SelectTrigger id="convite-papel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="membro">Membro: vê só as telas marcadas</SelectItem>
                  {souDono && <SelectItem value="admin">Admin: vê tudo e gerencia a equipe</SelectItem>}
                </SelectContent>
              </Select>
            </Campo>
            {papel === "membro" && <SeletorDeChaves valor={chaves} aoMudar={setChaves} desabilitado={enviando} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={aoFechar} disabled={enviando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando} className="bg-rec text-white hover:bg-rec/85">
                {enviando ? <Loader2 className="animate-spin" /> : <UserPlus />}
                Criar convite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
