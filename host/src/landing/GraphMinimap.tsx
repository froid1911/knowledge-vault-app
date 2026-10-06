import { useEffect, useRef, useState } from "react";
import type { FullGraph } from "../api/graph.js";
import { buildMinimapScene } from "./minimap.js";
import type { XY } from "./saved-layout.js";

/** A canvas cannot read var(); the tokens come from <html>'s data-bai-theme at draw time. */
function tokens(el: Element) {
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    edge: get("--bai-text-faint", "#4b5563"),
    note: get("--bai-text-muted", "#6b7280"),
    moc: get("--bai-accent", "#cba6f7"),
    DRAFT: get("--bai-status-draft", "#f59e0b"),
    IN_REVIEW: get("--bai-status-review", "#3b82f6"),
    CANONICAL: get("--bai-status-canonical", "#10b981"),
    ARCHIVED: get("--bai-status-archived", "#6b7280"),
  };
}

/**
 * The whole graph as the vault app laid it out — every node in its saved
 * position, every link as a hairline — drawn once per size and theme on a 2D
 * canvas. Thousands of edges read as texture; maps of content sit on top.
 */
export function GraphMinimap({ graph, positions, settled }: { graph: FullGraph; positions: Map<string, XY>; settled: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Redraw when the theme flips: the tokens live on <html>[data-bai-theme].
  const [theme, setTheme] = useState(() => (typeof document === "undefined" ? "" : document.documentElement.dataset.baiTheme ?? ""));
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.baiTheme ?? ""));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-bai-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const scene = buildMinimapScene(graph, positions, size.w, size.h, 12);
    const t = tokens(c);
    const dense = scene.segments.length > 3000;
    ctx.lineWidth = dense ? 0.5 : 0.7;
    ctx.strokeStyle = t.edge;
    ctx.globalAlpha = dense ? 0.28 : 0.5;
    ctx.beginPath();
    for (const s of scene.segments) {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const r = scene.points.length > 800 ? 1.3 : scene.points.length > 200 ? 1.7 : 2.3;
    for (const kind of ["note", "moc"] as const) {
      for (const p of scene.points) {
        if (p.kind !== kind) continue;
        ctx.fillStyle = kind === "moc" ? t.moc : ((t as Record<string, string>)[p.status ?? ""] ?? t.note);
        ctx.beginPath();
        ctx.arc(p.x, p.y, kind === "moc" ? r * 1.9 : r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [graph, positions, size, theme]);

  return (
    <div ref={box} className="kv-minimap" data-settled={settled} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
