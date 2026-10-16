"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Bot, CornerDownLeft, LogOut, Monitor, Moon, Search, Smartphone, Sun, type LucideIcon } from "lucide-react";

import { useSair } from "@/components/account-menu";
import { agentesDaPessoa, menuDaPessoa } from "@/components/nav";
import { setTheme, useTheme } from "@/components/theme";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Usuario } from "@/features/acesso/contrato";
import { useLayoutMode } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type Item = { id: string; grupo: string; label: string; dica?: string; icon: LucideIcon; acao: () => void };

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Busca rápida (Ctrl K): vai para qualquer tela ou agente e faz as ações da conta, só pelo teclado.
// Abre também pelo botão "Buscar" do menu (evento "hub:busca").
export function CommandMenu({ usuario, semBanco = false }: { usuario: Usuario; semBanco?: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const { isMobile, toggle } = useLayoutMode();
  const { form, sair } = useSair();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAtivo(0);
        setAberto((v) => !v);
      }
    };
    const abrir = () => {
      setAtivo(0);
      setAberto(true);
    };
    window.addEventListener("keydown", tecla);
    window.addEventListener("hub:busca", abrir);
    return () => {
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("hub:busca", abrir);
    };
  }, []);

  const itens = useMemo<Item[]>(() => {
    const ir = (href: string) => () => router.push(href);
    const telas = menuDaPessoa(usuario, semBanco).flatMap((g) =>
      g.itens.map((i) => ({ id: i.href, grupo: "Telas", label: i.label, dica: i.tool ?? g.titulo, icon: i.icon, acao: ir(i.href) })),
    );
    const agentes = agentesDaPessoa(usuario).map((a) => ({
      id: `/agentes/${a.id}`,
      grupo: "Agentes",
      label: a.name,
      dica: "Agente",
      icon: Bot,
      acao: ir(`/agentes/${a.id}`),
    }));
    const acoes: Item[] = [
      {
        id: "tema",
        grupo: "Ações",
        label: theme === "dark" ? "Usar tema claro" : "Usar tema escuro",
        icon: theme === "dark" ? Sun : Moon,
        acao: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      { id: "versao", grupo: "Ações", label: isMobile ? "Versão computador" : "Versão celular", icon: isMobile ? Monitor : Smartphone, acao: toggle },
      { id: "sair", grupo: "Ações", label: "Sair da conta", icon: LogOut, acao: sair },
    ];
    return [...telas, ...agentes, ...acoes];
  }, [usuario, semBanco, theme, isMobile, toggle, sair, router]);

  const filtrados = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    if (!termos.length) return itens;
    return itens.filter((i) => {
      const texto = normalizar(`${i.label} ${i.dica ?? ""} ${i.grupo}`);
      return termos.every((t) => texto.includes(t));
    });
  }, [busca, itens]);

  useEffect(() => {
    lista.current?.querySelector(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  const executar = (item: Item | undefined) => {
    if (!item) return;
    setAberto(false);
    setBusca("");
    item.acao();
  };

  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((a) => Math.min(a + 1, filtrados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executar(filtrados[ativo]);
    }
  };

  let grupoAnterior = "";
  return (
    <>
      {form}
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (!v) setBusca("");
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="top-[12vh] flex max-h-[min(560px,calc(100dvh-110px))] w-[620px] max-w-[calc(100vw-24px)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]"
        >
          <DialogTitle className="sr-only">Buscar</DialogTitle>
          <DialogDescription className="sr-only">Digite para achar uma tela, um agente ou uma ação.</DialogDescription>
          <div className="flex items-center gap-2.5 border-b border-border/70 pr-3.5 pl-4.5">
            <Search className="size-[18px] shrink-0 text-primary dark:text-[var(--brand-300)]" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setAtivo(0);
              }}
              onKeyDown={teclas}
              placeholder="Ir para uma tela, agente ou ação…"
              className="h-14 min-w-0 flex-1 bg-transparent text-[0.96875rem] outline-none placeholder:text-muted-foreground"
              aria-label="Buscar"
            />
            <kbd className="hub-kbd">Esc</kbd>
          </div>
          <div ref={lista} role="listbox" aria-label="Resultados" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
            {filtrados.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nada encontrado para “{busca}”.</p>}
            {filtrados.map((item, i) => {
              const titulo = item.grupo !== grupoAnterior ? item.grupo : null;
              grupoAnterior = item.grupo;
              const selecionado = i === ativo;
              return (
                <div key={item.id}>
                  {titulo && <span className="block px-2.5 pt-3 pb-1.5 font-mono text-[0.65625rem] tracking-[0.12em] text-muted-foreground/80 uppercase">{titulo}</span>}
                  <div
                    role="option"
                    aria-selected={selecionado}
                    data-indice={i}
                    onMouseMove={() => setAtivo(i)}
                    onClick={() => executar(item)}
                    className={cn(
                      "relative flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-sm text-foreground/80 transition-colors",
                      selecionado &&
                        "bg-accent text-foreground before:absolute before:top-[11px] before:bottom-[11px] before:left-0 before:w-0.5 before:rounded-full before:bg-[linear-gradient(var(--brand-400),var(--cyan-400))]",
                    )}
                  >
                    <item.icon className={cn("size-[18px] shrink-0 text-muted-foreground", selecionado && "text-primary dark:text-[var(--brand-300)]")} strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.dica && <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">{item.dica}</span>}
                    <CornerDownLeft className={cn("size-3.5 shrink-0 text-muted-foreground opacity-0", selecionado && "opacity-100")} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden gap-5 border-t border-border/70 px-4.5 py-2.5 text-[0.71875rem] text-muted-foreground sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <ArrowUp className="size-3" />
              <ArrowDown className="size-3" />
              navegar
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CornerDownLeft className="size-3" />
              abrir
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <kbd className="hub-kbd">Ctrl K</kbd>
              abre e fecha
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
