"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FRENTE_ROTULO, FRENTES, TIPO_ROTULO, TIPOS, type DocResumo, type Frente, type LinhaProjeto, type ResultadoBusca } from "@/features/memoria/contrato";
import { apiFetch } from "@/lib/generations";

export type Aba = "documentos" | "projetos" | "revisao";

// AAAA-MM-DD → DD/MM/AAAA, sem passar por fuso.
const dataCurta = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "—");
// Fuso fixo e texto montado aqui (não o do navegador): o servidor e o navegador desenham a mesma data, sem erro
// de hidratação.
const FORMATO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function quando(iso: string, comHora = false) {
  const p = Object.fromEntries(FORMATO.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}${comHora ? ` ${p.hour}:${p.minute}` : ""}`;
}
const motivo = (d: DocResumo) => (typeof d.metadados.motivoRevisao === "string" ? d.metadados.motivoRevisao : null);

// Marcadores de um documento (frente, mercado, no prompt, revisão), iguais na lista, na busca e na fila.
export function Marcadores({ d }: { d: DocResumo }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{FRENTE_ROTULO[d.frente]}</Badge>
      {d.mercado && <Badge variant="outline">{d.mercado}</Badge>}
      {d.noPrompt && (
        <Badge variant="secondary" className="bg-rec/15 text-rec" title="Entra inteiro no prompt dos agentes do hub">
          no prompt
        </Badge>
      )}
      {d.precisaRevisao && (
        <Badge variant="secondary" className="bg-warn/15 text-warn">
          revisar
        </Badge>
      )}
    </span>
  );
}

function LinhaDoc({ d, trecho }: { d: DocResumo; trecho?: string }) {
  return (
    <li className="border-b last:border-b-0">
      <Link href={`/memoria/${d.slug}`} className="flex flex-col gap-1 px-3 py-2.5 transition-colors hover:bg-muted/60">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 font-medium">{d.titulo}</span>
          <Marcadores d={d} />
        </span>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">
          {d.slug} · v{d.versao} · {quando(d.atualizadoEm)}
        </span>
        {trecho && <span className="text-sm text-foreground/80">{trecho}</span>}
      </Link>
    </li>
  );
}

export function MemoriaView({
  documentos,
  projetos,
  pendentes,
  abaInicial,
}: {
  documentos: DocResumo[];
  projetos: LinhaProjeto[];
  pendentes: DocResumo[];
  abaInicial: Aba;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [frente, setFrente] = useState<Frente | "todas">("todas");
  const [consulta, setConsulta] = useState("");
  // Última busca respondida, com a consulta e a frente a que ela se refere.
  const [busca, setBusca] = useState<{ chave: string; resultados: ResultadoBusca[] | null; erro: string | null } | null>(null);

  const q = consulta.trim();
  const chave = q ? `${frente}|${q}` : "";

  // Busca no servidor (com e sem acento, título pesando mais), 300 ms depois de parar de digitar.
  useEffect(() => {
    if (!chave) return;
    const controle = new AbortController();
    const t = setTimeout(() => {
      const p = new URLSearchParams({ q, limite: "30", ...(frente !== "todas" ? { frente } : {}) });
      apiFetch<{ resultados: ResultadoBusca[] }>(`/api/memoria/busca?${p}`, { signal: controle.signal })
        .then((r) => setBusca({ chave, resultados: r.resultados, erro: null }))
        .catch((err) => !controle.signal.aborted && setBusca({ chave, resultados: null, erro: err instanceof Error ? err.message : "Não consegui buscar." }));
    }, 300);
    return () => {
      clearTimeout(t);
      controle.abort();
    };
  }, [chave, q, frente]);

  // Enquanto a busca nova não volta, a anterior continua na tela (sem piscar a lista inteira).
  const buscando = Boolean(chave) && busca?.chave !== chave;
  const exibida = chave ? busca : null;
  const resultados = exibida?.resultados ?? (exibida ? [] : null);
  const erroBusca = exibida?.erro ?? null;

  const grupos = useMemo(() => {
    const visiveis = frente === "todas" ? documentos : documentos.filter((d) => d.frente === frente);
    return TIPOS.map((tipo) => ({ tipo, docs: visiveis.filter((d) => d.tipo === tipo) })).filter((g) => g.docs.length);
  }, [documentos, frente]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9">
      <PageHeader
        eyebrow="Operação"
        title="Memória"
        description="Regras, fluxos, dados do negócio, projetos e lições da operação. Os agentes do hub e o Claude Code de cada pessoa leem e gravam aqui, com histórico de versões."
      />

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList>
          <TabsTrigger value="documentos">
            Documentos
            <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{documentos.length}</span>
          </TabsTrigger>
          <TabsTrigger value="projetos">
            Projetos
            <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{projetos.length}</span>
          </TabsTrigger>
          <TabsTrigger value="revisao">Precisa de revisão ({pendentes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="documentos" className="mt-4 flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                placeholder="Buscar na memória (ex.: tradução, lipsync, Yara)"
                className="pl-8"
                aria-label="Buscar na memória"
              />
            </div>
            <Select value={frente} onValueChange={(v) => setFrente(v as Frente | "todas")}>
              <SelectTrigger className="w-44" aria-label="Frente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as frentes</SelectItem>
                {FRENTES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FRENTE_ROTULO[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {buscando && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          {erroBusca ? (
            <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erroBusca}</p>
          ) : resultados ? (
            resultados.length ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  {resultados.length} {resultados.length === 1 ? "resultado" : "resultados"}
                </h2>
                <ul className="border">
                  {resultados.map((r) => (
                    <LinhaDoc key={r.slug} d={r} trecho={r.trecho} />
                  ))}
                </ul>
              </section>
            ) : (
              <p className="border border-dashed py-10 text-center text-sm text-muted-foreground">Nada encontrado para “{consulta.trim()}”.</p>
            )
          ) : grupos.length ? (
            grupos.map((g) => (
              <section key={g.tipo} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 font-heading text-base">
                  <span className="size-2 shrink-0 bg-rec" aria-hidden />
                  {TIPO_ROTULO[g.tipo]}
                  <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{g.docs.length}</span>
                </h2>
                <ul className="border">
                  {g.docs.map((d) => (
                    <LinhaDoc key={d.slug} d={d} />
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="border border-dashed py-16 text-center text-sm text-muted-foreground">
              {documentos.length ? "Nenhum documento nesta frente." : "A Memória está vazia. A importação do contexto do Sávio ainda não foi feita neste banco."}
            </p>
          )}
        </TabsContent>

        <TabsContent value="projetos" className="mt-4">
          {projetos.length ? (
            <div className="lg:border">
              <Table empilhar>
                <TableHeader>
                  <TableRow>
                    <TableHead>Projeto</TableHead>
                    <TableHead>Frente</TableHead>
                    <TableHead>Mercado</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projetos.map((p) => (
                    <TableRow key={p.slug}>
                      <TableCell className="max-w-96 whitespace-normal">
                        <Link href={`/memoria/${p.slug}`} className="font-medium hover:text-rec hover:underline">
                          {p.titulo}
                        </Link>
                        <span className="block font-mono text-[0.6875rem] text-muted-foreground">{p.slug}</span>
                      </TableCell>
                      <TableCell data-rotulo="Frente" className="whitespace-normal">
                        {FRENTE_ROTULO[p.frente]}
                        {p.frenteOriginal && p.frenteOriginal !== FRENTE_ROTULO[p.frente] && (
                          <span className="block text-xs text-muted-foreground">{p.frenteOriginal}</span>
                        )}
                      </TableCell>
                      <TableCell data-rotulo="Mercado" className="whitespace-normal">
                        {p.mercado ?? "—"}
                      </TableCell>
                      <TableCell data-rotulo="Status" className="max-w-72 whitespace-normal">
                        {p.status ?? "—"}
                        {p.precisaRevisao && (
                          <Badge variant="secondary" className="ml-1.5 bg-warn/15 text-warn">
                            revisar
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell data-rotulo="Data" className="font-mono text-xs tabular-nums">
                        {dataCurta(p.data)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="border border-dashed py-16 text-center text-sm text-muted-foreground">Nenhum projeto registrado ainda.</p>
          )}
        </TabsContent>

        <TabsContent value="revisao" className="mt-4">
          {pendentes.length ? (
            <ul className="border">
              {pendentes.map((d) => (
                <li key={d.slug} className="border-b last:border-b-0">
                  <Link href={`/memoria/${d.slug}`} className="flex flex-col gap-1 px-3 py-2.5 transition-colors hover:bg-muted/60">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{d.titulo}</span>
                      <Badge variant="outline">{TIPO_ROTULO[d.tipo]}</Badge>
                    </span>
                    <span className="font-mono text-[0.6875rem] text-muted-foreground">{d.slug}</span>
                    {motivo(d) && <span className="text-sm text-foreground/80">{motivo(d)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border border-dashed py-16 text-center text-sm text-muted-foreground">Nada esperando revisão.</p>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
