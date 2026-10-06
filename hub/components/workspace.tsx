"use client";

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  LayoutTemplate,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

// Área de trabalho com abas redimensionáveis: arrastar a divisória, ocultar (vira uma faixa), maximizar
// e layouts prontos. O tamanho escolhido fica salvo no navegador por tela (localStorage).

const COLLAPSED_PX = 36;

// Tamanho de cada aba em % ou "collapsed" (oculta, só a faixa com o título).
export type WorkspacePreset = {
  id: string;
  label: string;
  layout: Record<string, number | "collapsed">;
};

type PanelEntry = {
  ref: PanelImperativeHandle | null;
  defaultSize: number;
  collapsible: boolean;
  // Começa fechada (só a faixa); "Restaurar tamanhos" volta a fechar.
  defaultCollapsed: boolean;
};

type Ctx = {
  orientation: "horizontal" | "vertical";
  register: (id: string, entry: PanelEntry) => void;
  maximize: (id: string) => void;
  maximized: string | null;
  // Versão celular: as abas viram botões e só a aba ativa aparece.
  tabs?: { active: string; reveal: (id: string) => void };
};

const WorkspaceContext = createContext<Ctx | null>(null);

// Áreas aninhadas (ex.: prévia + timeline dentro do editor) se registram na área de fora,
// para que os layouts prontos e o "restaurar" da barra mudem todas juntas.
type Registry = Map<
  string,
  {
    applyPreset: (layout: WorkspacePreset["layout"]) => void;
    reset: () => void;
  }
>;
const RegistryContext = createContext<Registry | null>(null);

// v2: novos tamanhos padrão (aba principal grande, resultados fechados); layouts salvos antes disso são ignorados.
const storageKey = (id: string) => `hub:workspace:v2:${id}`;

function readSaved(id: string): Layout | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as Layout) : null;
  } catch {
    return null;
  }
}

function writeSaved(id: string, layout: Layout) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(layout));
  } catch {}
}

export function Workspace({
  id,
  orientation = "horizontal",
  presets = [],
  toolbar,
  className,
  children,
}: {
  id: string;
  orientation?: "horizontal" | "vertical";
  presets?: WorkspacePreset[];
  // Conteúdo à esquerda da barra (título, ações). Sem toolbar e sem presets, a barra não aparece.
  toolbar?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const parentRegistry = useContext(RegistryContext);
  const [ownRegistry] = useState<Registry>(() => new Map());
  const registry = parentRegistry ?? ownRegistry;
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const panels = useRef(new Map<string, PanelEntry>());
  const [maximized, setMaximized] = useState<string | null>(null);
  const beforeMaximize = useRef<Layout | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const items = Children.toArray(children).filter(isValidElement);

  const register = useCallback((panelId: string, entry: PanelEntry) => {
    panels.current.set(panelId, entry);
  }, []);

  // Converte um preset (% e "collapsed") num layout válido que soma 100.
  const toLayout = useCallback(
    (preset: Record<string, number | "collapsed">): Layout => {
      const size =
        orientation === "horizontal"
          ? elementRef.current?.clientWidth
          : elementRef.current?.clientHeight;
      const collapsedPct = size ? (COLLAPSED_PX / size) * 100 : 3;
      const ids = [...panels.current.keys()];
      const open = ids.filter((p) => preset[p] !== "collapsed");
      const collapsed = ids.filter((p) => preset[p] === "collapsed");
      const free = 100 - collapsed.length * collapsedPct;
      const raw = open.map((p) =>
        typeof preset[p] === "number"
          ? (preset[p] as number)
          : panels.current.get(p)!.defaultSize,
      );
      const total = raw.reduce((a, b) => a + b, 0) || 1;
      const layout: Layout = {};
      collapsed.forEach((p) => (layout[p] = collapsedPct));
      open.forEach((p, i) => (layout[p] = (raw[i] / total) * free));
      return layout;
    },
    [orientation],
  );

  const apply = useCallback(
    (layout: Layout) => {
      groupRef.current?.setLayout(layout);
      writeSaved(id, layout);
    },
    [id],
  );

  // Restaura o layout salvo depois de montar (no servidor não existe localStorage; evita diferença na hidratação).
  useEffect(() => {
    const saved = readSaved(id);
    if (!saved || !groupRef.current) return;
    const ids = [...panels.current.keys()];
    if (ids.every((p) => typeof saved[p] === "number"))
      groupRef.current.setLayout(saved);
  }, [id, isMobile]);

  const maximize = useCallback(
    (panelId: string) => {
      if (maximized === panelId) {
        if (beforeMaximize.current) apply(beforeMaximize.current);
        setMaximized(null);
        return;
      }
      beforeMaximize.current = groupRef.current?.getLayout() ?? null;
      const preset: Record<string, number | "collapsed"> = {};
      panels.current.forEach(
        (entry, p) =>
          (preset[p] =
            p === panelId ? 100 : entry.collapsible ? "collapsed" : 0),
      );
      apply(toLayout(preset));
      setMaximized(panelId);
    },
    [apply, maximized, toLayout],
  );

  const resetOwn = useCallback(() => {
    const preset: Record<string, number | "collapsed"> = {};
    panels.current.forEach((entry, p) => (preset[p] = entry.defaultCollapsed && entry.collapsible ? "collapsed" : entry.defaultSize));
    apply(toLayout(preset));
    setMaximized(null);
  }, [apply, toLayout]);

  // Aplica só as chaves que são abas desta área.
  const applyOwn = useCallback(
    (layout: WorkspacePreset["layout"]) => {
      const mine = Object.fromEntries(
        Object.entries(layout).filter(([k]) => panels.current.has(k)),
      );
      if (!Object.keys(mine).length) return;
      apply(toLayout(mine));
      setMaximized(null);
    },
    [apply, toLayout],
  );

  useEffect(() => {
    registry.set(id, { applyPreset: applyOwn, reset: resetOwn });
    return () => {
      registry.delete(id);
    };
  }, [registry, id, applyOwn, resetOwn]);

  const applyPreset = (layout: WorkspacePreset["layout"]) =>
    registry.forEach((w) => w.applyPreset(layout));
  const reset = () => registry.forEach((w) => w.reset());

  const ctx = useMemo(
    () => ({ orientation, register, maximize, maximized }),
    [orientation, register, maximize, maximized],
  );

  // Versão celular: uma aba por vez, escolhida numa fileira de botões (áreas verticais continuam divididas).
  if (isMobile && orientation === "horizontal") {
    const tabList = items.map((child) => child.props as MobileTabProps);
    const current = tabList.some((t) => t.id === activeTab) ? activeTab! : defaultTab(tabList);
    return (
      <RegistryContext.Provider value={registry}>
        <WorkspaceContext.Provider value={{ ...ctx, tabs: { active: current, reveal: setActiveTab } }}>
          <div className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
            {toolbar && (
              <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
                {toolbar}
              </div>
            )}
            {tabList.length > 1 && (
              <div role="tablist" aria-label="Abas da tela" className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1.5">
                {tabList.map((t) => {
                  const selected = t.id === current;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveTab(t.id)}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
                        selected ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.title}
                      {t.badge ? (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rec px-1 font-mono text-[10px] leading-none font-bold text-white tabular-nums">
                          {t.badge > 99 ? "99+" : t.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="relative min-h-0 flex-1">{items}</div>
          </div>
        </WorkspaceContext.Provider>
      </RegistryContext.Provider>
    );
  }

  return (
    <RegistryContext.Provider value={registry}>
      <WorkspaceContext.Provider value={ctx}>
        <div className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
          {(toolbar || presets.length > 0) && (
            <div className="flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {toolbar}
              </div>
              {presets.length > 0 && (
                <div
                  className="flex shrink-0 items-center gap-1"
                  role="group"
                  aria-label="Layouts prontos"
                >
                  <LayoutTemplate
                    className="mr-1 size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  {presets.map((p) => (
                    <Button
                      key={p.id}
                      variant="ghost"
                      size="xs"
                      onClick={() => applyPreset(p.layout)}
                    >
                      {p.label}
                    </Button>
                  ))}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Restaurar tamanhos"
                        onClick={reset}
                      >
                        <RotateCcw />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Restaurar tamanhos</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
          <Group
            id={id}
            orientation={orientation}
            groupRef={groupRef}
            elementRef={elementRef}
            className="min-h-0 flex-1"
            onLayoutChanged={(layout, meta) => {
              if (meta.isUserInteraction) {
                writeSaved(id, meta.requestedLayout ?? layout);
                setMaximized(null);
              }
            }}
          >
            {items.flatMap((child, i) =>
              i === 0
                ? [child]
                : [
                    <Separator
                      key={`sep-${i}`}
                      className={cn(
                        "relative bg-border transition-colors outline-none hover:bg-rec/60 focus-visible:bg-rec data-[separator=active]:bg-rec",
                        orientation === "horizontal" ? "w-px" : "h-px",
                      )}
                    />,
                    child,
                  ],
            )}
          </Group>
        </div>
      </WorkspaceContext.Provider>
    </RegistryContext.Provider>
  );
}

type MobileTabProps = { id: string; title: string; badge?: number; collapsible?: boolean; defaultCollapsed?: boolean };

// Aba inicial no celular: a principal (não pode ser ocultada) ou a primeira que não nasce fechada.
function defaultTab(tabs: MobileTabProps[]) {
  return (tabs.find((t) => t.collapsible === false) ?? tabs.find((t) => !t.defaultCollapsed) ?? tabs[0])?.id ?? "";
}

export function WorkspacePanel({
  id,
  title,
  icon,
  actions,
  defaultSize = 50,
  minSize = 15,
  collapsible = true,
  defaultCollapsed = false,
  badge,
  fill = false,
  revealKey,
  bare = false,
  className,
  bodyClassName,
  children,
}: {
  id: string;
  title: string;
  // Começa fechada (só a faixa com o título). Ao abrir pela primeira vez, vai para defaultSize.
  defaultCollapsed?: boolean;
  // Contador (ex.: nº de gerações): bolinha vermelha na faixa fechada e no título.
  badge?: number;
  // No layout inicial ocupa o espaço que sobrar (use na aba principal quando outra nasce fechada,
  // para a soma não passar de 100%). defaultSize continua valendo para "Restaurar tamanhos".
  fill?: boolean;
  // Quando muda para um valor não vazio, a aba abre (ex.: detalhes ao selecionar um card).
  revealKey?: string | number | null;
  // Sem barra de título (para uma aba que só contém outra área).
  bare?: boolean;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  defaultSize?: number;
  minSize?: number;
  collapsible?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("WorkspacePanel precisa estar dentro de Workspace");
  const { orientation, register, maximize, maximized, tabs } = ctx;
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const startsCollapsed = defaultCollapsed && collapsible;
  // Já nasce no estado certo para não piscar o conteúdo antes de fechar.
  const [collapsed, setCollapsed] = useState(startsCollapsed);
  const isMobile = useIsMobile();

  useEffect(() => {
    register(id, { ref: panelRef.current, defaultSize, collapsible, defaultCollapsed: startsCollapsed });
  }, [id, defaultSize, collapsible, startsCollapsed, register]);

  // Abre a aba; se ela nunca foi aberta (nasceu fechada), vai para o tamanho padrão em vez do mínimo.
  const open = () => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.expand();
    if (panel.getSize().asPercentage < defaultSize - 0.5) panel.resize(`${defaultSize}%`);
  };

  const lastReveal = useRef(revealKey);
  useEffect(() => {
    if (revealKey === lastReveal.current) return;
    lastReveal.current = revealKey;
    if (revealKey == null || revealKey === "") return;
    if (tabs) tabs.reveal(id);
    else if (panelRef.current?.isCollapsed()) open();
    // open só lê refs e props estáveis; reabrir só quando a chave muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  const count = badge && badge > 0 ? (badge > 99 ? "99+" : String(badge)) : null;
  const badgeEl = count && (
    <span
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-rec px-1 font-mono text-[10px] leading-none font-bold text-white tabular-nums shadow-[0_0_0_2px_var(--background)]"
      aria-label={`${badge} itens`}
    >
      {count}
    </span>
  );

  const header = (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b bg-muted/40 px-3">
      {icon}
      <h2 className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11px] font-semibold tracking-wider text-foreground/75 uppercase">
        <span className="truncate">{title}</span>
        {badgeEl}
      </h2>
      {actions}
      {!isMobile && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={
                  maximized === id ? `Restaurar ${title}` : `Maximizar ${title}`
                }
                onClick={() => maximize(id)}
              >
                {maximized === id ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {maximized === id ? "Restaurar" : "Maximizar"}
            </TooltipContent>
          </Tooltip>
          {collapsible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Ocultar ${title}`}
                  onClick={() => panelRef.current?.collapse()}
                >
                  <PanelLeftClose
                    className={cn(orientation === "vertical" && "rotate-90")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ocultar</TooltipContent>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );

  if (tabs) {
    // O título já está no botão da aba; a barra só aparece se a aba tiver ações próprias.
    return (
      <section role="tabpanel" aria-label={title} className={cn("absolute inset-0 flex-col", tabs.active === id ? "flex" : "hidden", className)}>
        {actions && !bare && header}
        <div className={cn("min-h-0 flex-1", bare ? "flex flex-col" : "overflow-auto", bodyClassName)}>{children}</div>
      </section>
    );
  }

  return (
    <Panel
      id={id}
      panelRef={panelRef}
      defaultSize={startsCollapsed ? COLLAPSED_PX : fill ? undefined : `${defaultSize}%`}
      minSize={`${minSize}%`}
      collapsible={collapsible}
      collapsedSize={COLLAPSED_PX}
      onResize={(size) =>
        setCollapsed(collapsible && size.inPixels <= COLLAPSED_PX + 1)
      }
      // Sem isso a aba cresce até a largura do conteúdo (ex.: colunas do Kanban) e empurra a página.
      style={{ overflow: "hidden" }}
      className={cn("flex min-h-0 min-w-0 flex-col", className)}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={open}
          className={cn(
            "flex size-full items-center gap-2 bg-muted/30 text-[11px] font-semibold tracking-wider text-foreground/70 uppercase hover:bg-muted hover:text-foreground",
            orientation === "horizontal" ? "flex-col py-3" : "px-3",
          )}
          aria-label={`Mostrar ${title}${count ? ` (${badge})` : ""}`}
        >
          <PanelLeftOpen
            className={cn(
              "size-4 shrink-0",
              orientation === "vertical" && "rotate-90",
            )}
          />
          {badgeEl}
          <span
            className={cn(
              "truncate",
              orientation === "horizontal" && "[writing-mode:vertical-rl]",
            )}
          >
            {title}
          </span>
        </button>
      ) : (
        <>
          {!bare && header}
          <div
            className={cn(
              "min-h-0 flex-1",
              bare ? "flex flex-col" : "overflow-auto",
              bodyClassName,
            )}
          >
            {children}
          </div>
        </>
      )}
    </Panel>
  );
}
