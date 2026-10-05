"use client";

import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatTime,
  placeCaptions,
  placeClips,
  type EditorProject,
} from "@/lib/editor";
import { cn } from "@/lib/utils";

export type Selection = { type: "clip" | "caption"; id: string } | null;

type Drag =
  | { kind: "clip-in"; id: string; x: number; value: number }
  | { kind: "clip-out"; id: string; x: number; value: number }
  | {
      kind: "cap-move" | "cap-start" | "cap-end";
      id: string;
      x: number;
      start: number;
      end: number;
    };

const LABEL_W = 88;

// Timeline: clique para posicionar o playhead; arraste as bordas de um clipe para cortar,
// e as legendas para mover ou mudar a duração (os tempos ficam na mídia de origem).
export function Timeline({
  project,
  time,
  selection,
  onSeek,
  onSelect,
  onCheckpoint,
  onChange,
}: {
  project: EditorProject;
  time: number;
  selection: Selection;
  onSeek: (t: number) => void;
  onSelect: (s: Selection) => void;
  onCheckpoint: () => void; // guarda o estado antes de arrastar (para desfazer)
  onChange: (fn: (p: EditorProject) => EditorProject) => void;
}) {
  const { clips, total } = placeClips(project);
  const captions = placeCaptions(project);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerSec =
    (Math.max(200, width - LABEL_W - 24) / Math.max(1, total)) * zoom;
  const trackWidth = Math.max(1, total) * pxPerSec;
  const step =
    pxPerSec > 120 ? 0.5 : pxPerSec > 40 ? 1 : pxPerSec > 15 ? 5 : 10;

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(total, (e.clientX - r.left) / pxPerSec)));
  };

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onCheckpoint();
    drag.current = d;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.x) / pxPerSec;
    if (d.kind === "clip-in" || d.kind === "clip-out") {
      onChange((p) => ({
        ...p,
        clips: p.clips.map((c) => {
          if (c.id !== d.id) return c;
          const max = p.sources[c.sourceId]?.duration ?? c.out;
          return d.kind === "clip-in"
            ? { ...c, in: Math.max(0, Math.min(c.out - 0.1, d.value + dt)) }
            : { ...c, out: Math.min(max, Math.max(c.in + 0.1, d.value + dt)) };
        }),
      }));
      return;
    }
    const { kind, start, end } = d;
    onChange((p) => {
      return {
        ...p,
        captions: p.captions.map((c) => {
          if (c.id !== d.id) return c;
          if (kind === "cap-move") {
            const shift = Math.max(-start, dt);
            return { ...c, start: start + shift, end: end + shift };
          }
          if (kind === "cap-start")
            return {
              ...c,
              start: Math.max(0, Math.min(end - 0.1, start + dt)),
            };
          return { ...c, end: Math.max(start + 0.1, end + dt) };
        }),
      };
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  const ticks = Array.from(
    { length: Math.floor(total / step) + 1 },
    (_, i) => i * step,
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {formatTime(time)} / {formatTime(total)}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Diminuir zoom"
          onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
        >
          <ZoomOut />
        </Button>
        <span className="w-10 text-center font-mono tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Aumentar zoom"
          onClick={() => setZoom((z) => Math.min(20, z * 1.5))}
        >
          <ZoomIn />
        </Button>
      </div>
      <div
        ref={wrapRef}
        className="min-h-0 flex-1 overflow-auto"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="relative py-2 pr-6"
          style={{ width: LABEL_W + trackWidth + 24 }}
        >
          {/* Régua */}
          <div className="flex">
            <div
              className="sticky left-0 z-20 shrink-0 bg-background"
              style={{ width: LABEL_W }}
            />
            <div
              className="relative h-6 shrink-0 cursor-pointer border-b"
              style={{ width: trackWidth }}
              onPointerDown={seekFromEvent}
            >
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-1 -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
                  style={{ left: t * pxPerSec }}
                >
                  {t % 1 === 0 ? `${t}s` : "·"}
                </span>
              ))}
            </div>
          </div>

          <Track label="Vídeo">
            <div
              className="relative h-10 shrink-0 cursor-pointer rounded-md bg-muted"
              style={{ width: trackWidth }}
              onPointerDown={seekFromEvent}
            >
              {clips.map((c, i) => {
                const active =
                  selection?.type === "clip" && selection.id === c.id;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect({ type: "clip", id: c.id });
                      const r =
                        e.currentTarget.parentElement!.getBoundingClientRect();
                      onSeek(
                        Math.max(
                          0,
                          Math.min(total, (e.clientX - r.left) / pxPerSec),
                        ),
                      );
                    }}
                    onKeyDown={(e) =>
                      e.key === "Enter" && onSelect({ type: "clip", id: c.id })
                    }
                    className={cn(
                      "group absolute inset-y-0.5 overflow-hidden rounded-[5px] bg-track-avatar px-2 text-[11px] leading-9 font-semibold text-white outline-none",
                      i % 2 === 1 && "bg-track-broll",
                      active &&
                        "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                    )}
                    style={{
                      left: c.offset * pxPerSec,
                      width: Math.max(4, c.duration * pxPerSec - 2),
                    }}
                    title={project.sources[c.sourceId]?.label}
                  >
                    <span className="pointer-events-none truncate">
                      {project.sources[c.sourceId]?.label}
                    </span>
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                      onPointerDown={(e) =>
                        startDrag(e, {
                          kind: "clip-in",
                          id: c.id,
                          x: e.clientX,
                          value: c.in,
                        })
                      }
                    />
                    <span
                      aria-hidden
                      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                      onPointerDown={(e) =>
                        startDrag(e, {
                          kind: "clip-out",
                          id: c.id,
                          x: e.clientX,
                          value: c.out,
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>
          </Track>

          <Track label="Legendas">
            <div
              className="relative h-9 shrink-0 cursor-pointer rounded-md bg-muted"
              style={{ width: trackWidth }}
              onPointerDown={seekFromEvent}
            >
              {captions.map((c) => {
                const cap = project.captions.find((x) => x.id === c.captionId)!;
                const active =
                  selection?.type === "caption" && selection.id === c.captionId;
                return (
                  <div
                    key={c.key}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    title={c.text}
                    onPointerDown={(e) => {
                      onSelect({ type: "caption", id: c.captionId });
                      onSeek(c.start);
                      startDrag(e, {
                        kind: "cap-move",
                        id: cap.id,
                        x: e.clientX,
                        start: cap.start,
                        end: cap.end,
                      });
                    }}
                    className={cn(
                      "absolute inset-y-0.5 cursor-grab overflow-hidden rounded-[5px] bg-track-leg px-1.5 text-[10px] leading-8 font-semibold text-black/80 outline-none active:cursor-grabbing",
                      !project.captionsEnabled && "opacity-40",
                      active &&
                        "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                    )}
                    style={{
                      left: c.start * pxPerSec,
                      width: Math.max(4, (c.end - c.start) * pxPerSec - 1),
                    }}
                  >
                    <span className="pointer-events-none truncate">
                      {c.text.replace(/\*/g, "")}
                    </span>
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-black/30"
                      onPointerDown={(e) => {
                        onSelect({ type: "caption", id: c.captionId });
                        startDrag(e, {
                          kind: "cap-start",
                          id: cap.id,
                          x: e.clientX,
                          start: cap.start,
                          end: cap.end,
                        });
                      }}
                    />
                    <span
                      aria-hidden
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-black/30"
                      onPointerDown={(e) => {
                        onSelect({ type: "caption", id: c.captionId });
                        startDrag(e, {
                          kind: "cap-end",
                          id: cap.id,
                          x: e.clientX,
                          start: cap.start,
                          end: cap.end,
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </Track>

          {/* Playhead */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10"
            style={{ left: LABEL_W + time * pxPerSec }}
          >
            <div className="absolute inset-y-0 w-0.5 bg-rec before:absolute before:-top-0.5 before:-left-[5px] before:border-[6px] before:border-transparent before:border-t-rec" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Track({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex items-center">
      <div
        className="sticky left-0 z-20 shrink-0 bg-background px-3 text-xs font-medium text-muted-foreground"
        style={{ width: LABEL_W }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
