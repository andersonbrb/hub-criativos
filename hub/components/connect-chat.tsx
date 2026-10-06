"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, PlugZap, Sparkles, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/generations";
import { cn } from "@/lib/utils";

// "Conectar pelo chat": gera um token pessoal + um prompt para colar no Claude Code ou no Codex da pessoa.
// O agente dela configura a MCP do hub e passa a usar as ferramentas e os agentes do hub com a assinatura DELA.

type Person = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

const NAME_KEY = "hub:connect-name";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "ainda não usou");

const STEPS = [
  { title: "Gere o prompt de conexão", text: "Um token de acesso novo é criado junto com o prompt." },
  { title: "Cole no chat do Claude Code ou Codex", text: "O agente configura a conexão para todos os projetos do computador dele, usando as próprias ferramentas." },
  {
    title: "Peça os criativos no seu Claude Code",
    text: "Depois que o agente confirmar, use as ferramentas do hub direto de lá. Os agentes viram comandos: /mcp__hub-criativos__copy, /mcp__hub-criativos__estrategista…",
  },
];

export function ConnectChatButton({ className, label = "Conectar pelo chat" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nome lembrado neste navegador
      setName((n) => n || localStorage.getItem(NAME_KEY) || "");
    } catch {}
    apiFetch<{ people: Person[] }>("/api/conexoes")
      .then((d) => setPeople(d.people))
      .catch(() => setPeople([]));
  }, [open]);

  async function generate() {
    setBusy(true);
    try {
      const res = await apiFetch<{ person: Person; prompt: string }>("/api/conexoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      try {
        localStorage.setItem(NAME_KEY, res.person.name);
      } catch {}
      setPrompt(res.prompt);
      setCopied(false);
      setPeople((cur) => [res.person, ...(cur ?? []).filter((p) => p.name.toLowerCase() !== res.person.name.toLowerCase())]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui gerar o token.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success("Prompt copiado. Cole no Claude Code ou no Codex.");
    } catch {
      toast.error("Não consegui copiar; selecione o texto e copie à mão.");
    }
  }

  async function revoke(p: Person) {
    try {
      await apiFetch(`/api/conexoes/${p.id}`, { method: "DELETE" });
      setPeople((cur) => (cur ?? []).filter((x) => x.id !== p.id));
      toast.success(`${p.name} desconectado.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui desconectar.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPrompt(""); // o token só aparece uma vez
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <PlugZap />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">Conectar pelo chat</DialogTitle>
          <DialogDescription>
            Gere um prompt e cole no Claude Code ou no Codex. O agente conecta o Hub de Criativos em todos os projetos do computador dele, e você usa as
            ferramentas e os agentes do hub com a sua própria assinatura.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-rec/15 text-xs font-semibold text-rec">{i + 1}</span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{s.title}</span>
                <span className="text-xs text-muted-foreground">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Cada token novo desliga o anterior da mesma pessoa. Se você já conectou outro chat ou outro computador, cole o prompt novo lá também.
        </p>

        {!prompt ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Seu nome (ex.: Anderson, Darlan)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && generate()}
              aria-label="Seu nome"
            />
            <Button className="shrink-0 bg-rec text-white hover:bg-rec/85" disabled={!name.trim() || busy} onClick={generate}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Gerar token e prompt
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Textarea readOnly value={prompt} rows={9} className="font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} aria-label="Prompt de conexão" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">O token aparece só agora. Fechou sem copiar? Gere outro.</span>
              <Button className={cn("shrink-0", copied ? "" : "bg-rec text-white hover:bg-rec/85")} variant={copied ? "outline" : "default"} onClick={copy}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copiado" : "Copiar prompt"}
              </Button>
            </div>
          </div>
        )}

        {people && people.length > 0 && (
          <section className="flex flex-col gap-1.5 border-t pt-3">
            <span className="text-[11px] font-semibold tracking-wider text-foreground/85 uppercase">Conectados</span>
            <ul className="flex flex-col gap-1">
              {people.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                  <span className="min-w-0 truncate">
                    {p.name} <span className="text-xs text-muted-foreground">· último uso: {when(p.lastUsedAt)}</span>
                  </span>
                  <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => revoke(p)}>
                    <Unplug />
                    Desconectar
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-[11px] text-muted-foreground">
          A conexão depende das ferramentas e do acesso à rede do agente. Ele deve confirmar se conseguiu se conectar ou dizer o que falta. Os links das mídias geradas
          abrem no hub e pedem a senha de acesso.
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Fechar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
