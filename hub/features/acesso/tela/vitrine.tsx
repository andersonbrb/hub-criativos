"use client";

import { useEffect, useRef } from "react";
import { Bot, Mic, Scissors, Sparkles } from "lucide-react";

import { HubLogo, HubMark } from "@/components/hub-logo";
import { useHolofote } from "@/components/shell-effects";

// Constelação viva: pontos que derivam, se ligam por linhas e são puxados pelo ponteiro (ciano perto dele).
// Mesma receita do Ownly e da Cifra. Com movimento reduzido, desenha um quadro só.
function Constelacao({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const parado = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    type Ponto = { x: number; y: number; vx: number; vy: number; r: number };
    let pontos: Ponto[] = [];
    let w = 0;
    let h = 0;
    let quadro = 0;
    const mouse = { x: -9999, y: -9999 };

    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const caixa = canvas.getBoundingClientRect();
      w = caixa.width;
      h = caixa.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const total = Math.min(90, Math.round((w * h) / 12000));
      pontos = Array.from({ length: total }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.1 + 0.6,
      }));
    };

    const desenhar = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pontos) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 190 && d > 0) {
          const forca = d < 56 ? -0.05 : 0.014;
          p.vx += (dx / d) * forca;
          p.vy += (dy / d) * forca;
        }
        p.vx = p.vx * 0.985 + (Math.random() - 0.5) * 0.01;
        p.vy = p.vy * 0.985 + (Math.random() - 0.5) * 0.01;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x += w;
        if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += h;
        if (p.y > h) p.y -= h;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < pontos.length; i++) {
        const a = pontos[i];
        for (let j = i + 1; j < pontos.length; j++) {
          const b = pontos[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 118) {
            ctx.strokeStyle = `rgba(243,246,255,${(1 - d / 118) * 0.2})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (dm < 170) {
          ctx.strokeStyle = `rgba(127,240,255,${(1 - dm / 170) * 0.5})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
      for (const p of pontos) {
        const perto = Math.hypot(p.x - mouse.x, p.y - mouse.y) < 170;
        ctx.fillStyle = perto ? "rgba(127,240,255,0.95)" : "rgba(243,246,255,0.55)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + (perto ? 0.6 : 0), 0, Math.PI * 2);
        ctx.fill();
      }
      if (!parado) quadro = requestAnimationFrame(desenhar);
    };

    const mover = (e: PointerEvent) => {
      const caixa = canvas.getBoundingClientRect();
      mouse.x = e.clientX - caixa.left;
      mouse.y = e.clientY - caixa.top;
    };
    const sair = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    medir();
    desenhar();
    const obs = new ResizeObserver(() => {
      medir();
      if (parado) desenhar();
    });
    obs.observe(canvas);
    const alvo = canvas.parentElement ?? canvas;
    alvo.addEventListener("pointermove", mover);
    alvo.addEventListener("pointerleave", sair);
    return () => {
      cancelAnimationFrame(quadro);
      obs.disconnect();
      alvo.removeEventListener("pointermove", mover);
      alvo.removeEventListener("pointerleave", sair);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

// Grade que acende perto do ponteiro e a marca que inclina na direção dele.
function seguir(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const caixa = el.getBoundingClientRect();
  const x = e.clientX - caixa.left;
  const y = e.clientY - caixa.top;
  el.style.setProperty("--mx", `${x}px`);
  el.style.setProperty("--my", `${y}px`);
  el.style.setProperty("--tilt-x", `${(y / caixa.height - 0.5) * -16}deg`);
  el.style.setProperty("--tilt-y", `${(x / caixa.width - 0.5) * 22}deg`);
}

const ONDA = [0, 0.35, 0.7, 0.15, 0.5, 0.9, 0.25, 0.6, 1.05, 0.4, 0.8, 0.1, 0.55, 0.95, 0.3, 0.65, 1.0, 0.2];

// Lado esquerdo das telas de entrada: a vitrine do hub (só enfeite; no celular vira uma faixa com o título).
export function VitrineDoHub() {
  useHolofote();
  return (
    <section className="hub-auth-hero" onPointerMove={seguir}>
      <Constelacao className="hub-auth-stars" />
      <div className="hub-auth-grid" aria-hidden="true" />
      <div className="hub-auth-beams" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="hub-auth-aurora" aria-hidden="true">
        <i />
        <i />
      </div>

      <HubLogo inverse large />

      <div className="hub-auth-copy">
        <div className="hub-auth-mark" aria-hidden="true">
          <HubMark />
        </div>
        <h1>
          Do briefing
          <br />
          <span className="hub-gradient-text">ao vídeo pronto.</span>
        </h1>
        <p>Agentes de IA, estúdios de voz, avatar e imagem, edição de vídeo e o quadro da produção, juntos num só lugar.</p>
        <ul className="hub-auth-chips" aria-label="O que o hub faz">
          <li>
            <Bot size={14} />
            Agentes de IA
          </li>
          <li>
            <Mic size={14} />
            Voz e avatar
          </li>
          <li>
            <Sparkles size={14} />
            Imagem e vídeo
          </li>
          <li>
            <Scissors size={14} />
            Edição local
          </li>
        </ul>
      </div>

      <div className="hub-auth-figure" aria-hidden="true">
        <div className="hub-auth-figure-head">
          <span>Produção · agora</span>
          <span>
            <i className="hub-live" />
            ao vivo
          </span>
        </div>
        <strong>Criativo 9:16 · gancho, prova e oferta</strong>
        <div className="hub-auth-wave">
          {ONDA.map((atraso, i) => (
            <span key={i} style={{ animationDelay: `${-atraso}s` }} />
          ))}
        </div>
        <div className="hub-auth-progress" />
        <div className="hub-auth-meta">
          <span>Montando a edição</span>
          <span>87%</span>
        </div>
      </div>

      <div className="hub-auth-foot">
        <small>© {new Date().getFullYear()} Grupo Chegou</small>
        <span className="hub-auth-status">
          <i className="hub-live" aria-hidden="true" />
          Sistema online
        </span>
      </div>
    </section>
  );
}
