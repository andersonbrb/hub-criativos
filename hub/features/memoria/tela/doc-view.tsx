"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, History, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/chat/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TIPO_ROTULO, type Doc, type Versao } from "@/features/memoria/contrato";
import { Marcadores, quando } from "@/features/memoria/tela/memoria-view";
import { trocarLinksMd } from "@/features/memoria/texto";

type Resposta<T> = { ok: true; dados: T } | { ok: false; status: number; erro: string; versaoAtual?: number };

// Como o apiFetch, mas devolve o status: o 409 (conflito de versão) tem tratamento próprio na edição.
async function chamar<T>(url: string, init?: RequestInit): Promise<Resposta<T>> {
  try {
    const res = await fetch(url, init);
    const dados = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, dados: dados as T };
    const { error, versaoAtual } = dados as { error?: string; versaoAtual?: number };
    return { ok: false, status: res.status, erro: error ?? `Erro ${res.status}`, versaoAtual };
  } catch {
    return { ok: false, status: 0, erro: "Sem conexão com o hub. Tente de novo." };
  }
}

const json = (corpo: unknown): RequestInit => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

// Para ler na tela: o "# Título" já está no cabeçalho da página, e o bloco --- de metadados de alguns playbooks
// viraria um título solto no markdown; ele aparece como bloco de código.
function paraExibir(md: string, titulo: string): string {
  const semTitulo = md.replace(/^#\s+(.+)\n+/, (linha, t: string) => (t.trim() === titulo ? "" : linha));
  return semTitulo.replace(/^---\n([\s\S]*?)\n---\n/, (_, meta: string) => `\`\`\`yaml\n${meta}\n\`\`\`\n`);
}

export function DocView({ inicial, slugs, podeEditar }: { inicial: Doc; slugs: string[]; podeEditar: boolean }) {
  const [doc, setDoc] = useState(inicial);
  const url = `/api/memoria/${encodeURIComponent(doc.slug)}`;
  const existe = useMemo(() => {
    const s = new Set(slugs);
    return (slug: string) => s.has(slug);
  }, [slugs]);

  // Versão antiga aberta para ler (null = a atual).
  const [vendo, setVendo] = useState<Doc | null>(null);
  const [historico, setHistorico] = useState<Versao[] | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [nota, setNota] = useState("");
  const [conflito, setConflito] = useState<string | null>(null);
  // Depois de recarregar num conflito: o texto que está salvo agora, para comparar com o rascunho.
  const [salvoAgora, setSalvoAgora] = useState<string | null>(null);

  const mostrado = vendo ?? doc;
  const motivo = typeof doc.metadados.motivoRevisao === "string" ? doc.metadados.motivoRevisao : null;

  async function carregarHistorico() {
    const r = await chamar<{ versoes: Versao[] }>(`${url}/historico`);
    if (r.ok) setHistorico(r.dados.versoes);
    else toast.error(r.erro);
  }

  async function alternarHistorico() {
    const abrir = !mostrarHistorico;
    setMostrarHistorico(abrir);
    if (abrir && !historico) await carregarHistorico();
  }

  async function verVersao(versao: number) {
    if (versao === doc.versao) return setVendo(null);
    setOcupado(`ver-${versao}`);
    const r = await chamar<{ documento: Doc }>(`${url}?versao=${versao}`);
    setOcupado(null);
    if (!r.ok) return toast.error(r.erro);
    setVendo(r.dados.documento);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function restaurarVersao(versao: number) {
    if (!window.confirm(`Restaurar a versão ${versao}? O texto dela vira uma versão nova; nada é apagado.`)) return;
    setOcupado(`restaurar-${versao}`);
    const r = await chamar<{ documento: Doc }>(`${url}/restaurar`, { method: "POST", ...json({ versao }) });
    setOcupado(null);
    if (!r.ok) return toast.error(r.erro);
    const antes = doc.versao;
    setDoc(r.dados.documento);
    setVendo(null);
    toast.success(r.dados.documento.versao === antes ? "Essa versão já é igual à atual." : `Versão ${versao} restaurada como versão ${r.dados.documento.versao}.`);
    await carregarHistorico();
  }

  async function marcarRevisado() {
    setOcupado("revisado");
    const r = await chamar<{ documento: Doc }>(`${url}/revisado`, { method: "POST" });
    setOcupado(null);
    if (!r.ok) return toast.error(r.erro);
    setDoc(r.dados.documento);
    toast.success("Documento revisado: saiu da fila.");
  }

  function abrirEdicao() {
    setVendo(null);
    setRascunho(doc.conteudo);
    setNota("");
    setConflito(null);
    setSalvoAgora(null);
    setEditando(true);
  }

  async function salvar() {
    setOcupado("salvar");
    const r = await chamar<{ documento: Doc }>(url, { method: "PUT", ...json({ conteudo: rascunho, versaoEsperada: doc.versao, nota: nota || undefined }) });
    setOcupado(null);
    if (!r.ok) {
      if (r.status === 409) setConflito(r.erro);
      else toast.error(r.erro);
      return;
    }
    const antes = doc.versao;
    setDoc(r.dados.documento);
    setEditando(false);
    setConflito(null);
    setSalvoAgora(null);
    setHistorico(null);
    setMostrarHistorico(false);
    toast.success(r.dados.documento.versao === antes ? "Nada mudou no texto." : `Salvo como versão ${r.dados.documento.versao}.`);
  }

  // Conflito: traz a versão nova sem tocar no rascunho; a pessoa reaplica a mudança e salva sobre ela.
  async function recarregar() {
    setOcupado("recarregar");
    const r = await chamar<{ documento: Doc }>(url);
    setOcupado(null);
    if (!r.ok) return toast.error(r.erro);
    setDoc(r.dados.documento);
    setSalvoAgora(r.dados.documento.conteudo);
    setConflito(null);
    setHistorico(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 md:px-8 md:py-9">
      <Link href="/memoria" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Memória
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
              {TIPO_ROTULO[doc.tipo]} · {doc.slug}
            </p>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-balance md:text-3xl">{doc.titulo}</h1>
          </div>
          {!editando && (
            <div className="flex flex-wrap items-center gap-2">
              {podeEditar && doc.precisaRevisao && (
                <Button variant="outline" size="sm" onClick={marcarRevisado} disabled={!!ocupado}>
                  {ocupado === "revisado" ? <Loader2 className="animate-spin" /> : <Check />}
                  Marcar como revisado
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={alternarHistorico} aria-expanded={mostrarHistorico}>
                <History />
                Histórico
              </Button>
              {podeEditar && (
                <Button size="sm" onClick={abrirEdicao}>
                  <Pencil />
                  Editar
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <Marcadores d={doc} />
          <span>
            Versão {doc.versao} · {doc.autor} · {quando(doc.atualizadoEm, true)}
          </span>
        </div>
        {doc.precisaRevisao && motivo && (
          <p className="border-l-2 border-warn bg-warn/10 px-3 py-2 text-sm">
            <strong className="font-semibold">Precisa de revisão:</strong> {motivo}
          </p>
        )}
      </header>

      {mostrarHistorico && !editando && (
        <section className="border">
          <h2 className="border-b bg-muted px-3 py-2 text-xs font-semibold tracking-wide uppercase">Histórico de versões</h2>
          {!historico ? (
            <Loader2 className="mx-auto my-6 size-4 animate-spin text-muted-foreground" />
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {historico.map((v) => (
                <li key={v.versao} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-sm last:border-b-0">
                  <span className="w-10 font-mono text-xs tabular-nums">v{v.versao}</span>
                  <span className="min-w-0 flex-1">
                    {v.autor}
                    <span className="text-muted-foreground"> · {quando(v.criadoEm, true)}</span>
                    {v.nota && <span className="block text-xs text-muted-foreground">{v.nota}</span>}
                  </span>
                  {v.versao === doc.versao ? (
                    <Badge variant="outline">atual</Badge>
                  ) : (
                    <span className="flex gap-1.5">
                      <Button variant="ghost" size="xs" onClick={() => verVersao(v.versao)} disabled={!!ocupado}>
                        {ocupado === `ver-${v.versao}` && <Loader2 className="animate-spin" />}
                        Ver
                      </Button>
                      {podeEditar && (
                        <Button variant="ghost" size="xs" onClick={() => restaurarVersao(v.versao)} disabled={!!ocupado}>
                          {ocupado === `restaurar-${v.versao}` ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                          Restaurar
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editando ? (
        <section className="flex flex-col gap-3">
          {conflito && (
            <div className="flex flex-wrap items-center justify-between gap-2 border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">{conflito}</span>
              <Button size="sm" variant="outline" onClick={recarregar} disabled={!!ocupado}>
                {ocupado === "recarregar" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Recarregar sem perder meu texto
              </Button>
            </div>
          )}
          {salvoAgora !== null && (
            <details className="border bg-muted/40 text-sm" open>
              <summary className="cursor-pointer px-3 py-2 font-medium">
                Texto salvo agora (versão {doc.versao}). Compare e reaplique a sua mudança na caixa abaixo.
              </summary>
              <pre className="max-h-72 overflow-auto border-t px-3 py-2 font-mono text-xs whitespace-pre-wrap">{salvoAgora}</pre>
            </details>
          )}
          <Textarea
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            className="min-h-[65vh] font-mono text-sm leading-relaxed"
            spellCheck={false}
            aria-label="Texto do documento (markdown)"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="O que mudou (opcional, aparece no histórico)" className="min-w-60 flex-1" />
            <Button variant="outline" onClick={() => setEditando(false)} disabled={ocupado === "salvar"}>
              <X />
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={!!ocupado || !rascunho.trim()}>
              {ocupado === "salvar" ? <Loader2 className="animate-spin" /> : <Check />}
              Salvar como versão {doc.versao + 1}
            </Button>
          </div>
        </section>
      ) : (
        <>
          {vendo && (
            <div className="flex flex-wrap items-center justify-between gap-2 border border-rec/40 bg-rec/10 px-3 py-2 text-sm">
              <span>
                Você está vendo a versão {vendo.versao} ({vendo.autor}, {quando(vendo.atualizadoEm, true)}). A atual é a {doc.versao}.
              </span>
              <span className="flex gap-2">
                {podeEditar && (
                  <Button size="sm" variant="outline" onClick={() => restaurarVersao(vendo.versao)} disabled={!!ocupado}>
                    <RotateCcw />
                    Restaurar esta versão
                  </Button>
                )}
                <Button size="sm" onClick={() => setVendo(null)}>
                  Voltar para a atual
                </Button>
              </span>
            </div>
          )}
          <article className="border bg-card px-4 py-5 text-sm md:px-6">
            <Markdown text={trocarLinksMd(paraExibir(mostrado.conteudo, mostrado.titulo), existe)} />
          </article>
        </>
      )}
    </main>
  );
}
