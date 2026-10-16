"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Check, Copy, KeyRound, Loader2, Pause, Pencil, Play } from "lucide-react";
import { toast } from "sonner";

import { NOME_DA_ORGANIZACAO_MAXIMO, ROTULO_DA_SITUACAO, type OrganizacaoDaPlataforma } from "@/features/acesso/contrato";
import { Campo } from "@/features/acesso/tela/cartao";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/generations";

const JSON_HEADERS = { "Content-Type": "application/json" };
const erroDe = (err: unknown, padrao: string) => (err instanceof Error ? err.message : padrao);
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

type Janela =
  | { tipo: "nova" }
  | { tipo: "renomear"; org: OrganizacaoDaPlataforma }
  | { tipo: "dono"; org: OrganizacaoDaPlataforma }
  | { tipo: "link"; titulo: string; texto: string; link: string };

// Tela Plataforma (como no Cifra): todas as organizações do hub. Quem opera a plataforma cria uma organização com o
// convite do primeiro dono, muda o nome e suspende. Os dados de cada organização continuam só com a equipe dela.
export function TelaDaPlataforma() {
  const [organizacoes, setOrganizacoes] = useState<OrganizacaoDaPlataforma[] | null>(null);
  const [janela, setJanela] = useState<Janela | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(
    () =>
      apiFetch<{ organizacoes: OrganizacaoDaPlataforma[] }>("/api/plataforma/organizacoes")
        .then((r) => setOrganizacoes(r.organizacoes))
        .catch((err) => {
          setOrganizacoes([]);
          toast.error(erroDe(err, "Não consegui carregar as organizações."));
        }),
    [],
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  const trocar = (org: OrganizacaoDaPlataforma) => setOrganizacoes((lista) => (lista ?? []).map((o) => (o.id === org.id ? org : o)));

  async function alternarSituacao(org: OrganizacaoDaPlataforma) {
    const suspender = org.situacao === "ativa";
    if (suspender && !confirm(`Suspender ${org.nome}? A equipe perde o acesso às telas até você reativar. Os dados continuam guardados.`)) return;
    setOcupado(org.id);
    try {
      const r = await apiFetch<{ organizacao: OrganizacaoDaPlataforma }>(`/api/plataforma/organizacoes/${org.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ situacao: suspender ? "suspensa" : "ativa" }),
      });
      trocar(r.organizacao);
      toast.success(suspender ? `${org.nome} foi suspensa.` : `${org.nome} foi reativada.`);
    } catch (err) {
      toast.error(erroDe(err, "Não deu para mudar a situação."));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9">
      <PageHeader
        eyebrow="Plataforma"
        title="Organizações"
        description="Cada organização tem a própria equipe, criativos, conversas, Fluxo, Memória e integrações, sem enxergar as outras. Daqui você cria, renomeia e suspende; para entrar numa organização, você precisa ser convidado como qualquer pessoa."
      >
        <Button onClick={() => setJanela({ tipo: "nova" })} className="bg-rec text-white hover:bg-rec/85">
          <Building2 />
          Nova organização
        </Button>
      </PageHeader>

      {organizacoes === null ? (
        <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organização</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Pessoas</TableHead>
              <TableHead>Donos</TableHead>
              <TableHead>Convites</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizacoes.map((o) => (
              <TableRow key={o.id} className={o.situacao === "ativa" ? undefined : "text-muted-foreground"}>
                <TableCell className="font-medium">
                  {o.nome}
                  {o.padrao && <span className="ml-1.5 text-xs text-muted-foreground">(da plataforma)</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={o.situacao === "ativa" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}>
                    {ROTULO_DA_SITUACAO[o.situacao]}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{o.membros}</TableCell>
                <TableCell className="text-sm">{o.donos.length ? o.donos.join(", ") : <span className="text-warn">Sem dono</span>}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{o.convitesPendentes}</TableCell>
                <TableCell className="text-xs">{dia(o.criadoEm)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => setJanela({ tipo: "renomear", org: o })} disabled={ocupado === o.id}>
                      <Pencil />
                      Nome
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setJanela({ tipo: "dono", org: o })} disabled={ocupado === o.id}>
                      <KeyRound />
                      Link de dono
                    </Button>
                    {!o.padrao && (
                      <Button size="xs" variant={o.situacao === "ativa" ? "destructive" : "outline"} onClick={() => alternarSituacao(o)} disabled={ocupado === o.id}>
                        {ocupado === o.id ? <Loader2 className="animate-spin" /> : o.situacao === "ativa" ? <Pause /> : <Play />}
                        {o.situacao === "ativa" ? "Suspender" : "Reativar"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {janela?.tipo === "nova" && (
        <NovaOrganizacao
          aoFechar={() => setJanela(null)}
          aoCriar={(org, link) => {
            setOrganizacoes((lista) => [...(lista ?? []), org].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
            setJanela({
              tipo: "link",
              titulo: "Organização criada",
              texto: `Mande este link para quem vai ser o dono de ${org.nome}. Vale 7 dias e serve uma vez só. Se for você, abra o link e confirme com a sua senha.`,
              link,
            });
          }}
        />
      )}
      {janela?.tipo === "renomear" && <Renomear org={janela.org} aoFechar={() => setJanela(null)} aoSalvar={(org) => (trocar(org), setJanela(null))} />}
      {janela?.tipo === "dono" && (
        <LinkDeDono
          org={janela.org}
          aoFechar={() => setJanela(null)}
          aoCriar={(link) => {
            carregar();
            setJanela({ tipo: "link", titulo: "Link de dono criado", texto: `Mande para a pessoa. Ao aceitar, ela vira dona de ${janela.org.nome}. Vale 7 dias e serve uma vez só.`, link });
          }}
        />
      )}
      {janela?.tipo === "link" && <LinkPronto titulo={janela.titulo} texto={janela.texto} link={janela.link} aoFechar={() => setJanela(null)} />}
    </main>
  );
}

function NovaOrganizacao({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (org: OrganizacaoDaPlataforma, link: string) => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [nomeDoDono, setNomeDoDono] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await apiFetch<{ organizacao: OrganizacaoDaPlataforma; link: string }>("/api/plataforma/organizacoes", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ nome, email, nomeDoDono: nomeDoDono || undefined }),
      });
      aoCriar(r.organizacao, `${window.location.origin}${r.link}`);
    } catch (err) {
      toast.error(erroDe(err, "Não deu para criar a organização."));
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova organização</DialogTitle>
          <DialogDescription>Ela nasce vazia, com a própria equipe e os próprios dados. O primeiro dono entra pelo link do convite.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="grid gap-4">
          <Campo rotulo="Nome da organização" id="org-nome">
            <Input id="org-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={NOME_DA_ORGANIZACAO_MAXIMO} required autoFocus />
          </Campo>
          <Campo rotulo="E-mail do primeiro dono" id="org-email" dica="Pode ser o seu: aí você entra nela confirmando com a sua senha.">
            <Input id="org-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Campo>
          <Campo rotulo="Nome do dono (opcional)" id="org-dono">
            <Input id="org-dono" value={nomeDoDono} onChange={(e) => setNomeDoDono(e.target.value)} maxLength={100} />
          </Campo>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando} className="bg-rec text-white hover:bg-rec/85">
              {enviando ? <Loader2 className="animate-spin" /> : <Building2 />}
              Criar organização
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Renomear({ org, aoFechar, aoSalvar }: { org: OrganizacaoDaPlataforma; aoFechar: () => void; aoSalvar: (org: OrganizacaoDaPlataforma) => void }) {
  const [nome, setNome] = useState(org.nome);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await apiFetch<{ organizacao: OrganizacaoDaPlataforma }>(`/api/plataforma/organizacoes/${org.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ nome }),
      });
      toast.success("Nome salvo.");
      aoSalvar(r.organizacao);
    } catch (err) {
      toast.error(erroDe(err, "Não deu para salvar o nome."));
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nome da organização</DialogTitle>
          <DialogDescription>Aparece no menu da equipe, nos convites e para o Claude conectado.</DialogDescription>
        </DialogHeader>
        <form onSubmit={salvar} className="grid gap-4">
          <Input aria-label="Nome da organização" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={NOME_DA_ORGANIZACAO_MAXIMO} required autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando || !nome.trim()}>
              {salvando && <Loader2 className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkDeDono({ org, aoFechar, aoCriar }: { org: OrganizacaoDaPlataforma; aoFechar: () => void; aoCriar: (link: string) => void }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await apiFetch<{ link: string }>(`/api/plataforma/organizacoes/${org.id}/convite`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, nome: nome || undefined }),
      });
      aoCriar(`${window.location.origin}${r.link}`);
    } catch (err) {
      toast.error(erroDe(err, "Não deu para criar o link."));
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link de dono · {org.nome}</DialogTitle>
          <DialogDescription>Para quando o primeiro dono perdeu o link ou a organização ficou sem ninguém que mande. O link novo substitui o anterior.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="grid gap-4">
          <Campo rotulo="E-mail" id="dono-email">
            <Input id="dono-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Campo>
          <Campo rotulo="Nome (opcional)" id="dono-nome">
            <Input id="dono-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
          </Campo>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Criar link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkPronto({ titulo, texto, link, aoFechar }: { titulo: string; texto: string; link: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não consegui copiar. Selecione o link e copie à mão.");
    }
  }
  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{texto} O link não aparece de novo.</DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
