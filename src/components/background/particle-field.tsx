import { useEffect, useRef } from "react";

/**
 * Lightweight connected-node particle field on a single canvas.
 *
 * Perf-tuned:
 *  • Frame rate capped to ~30fps (the drift is slow; 60fps was pure waste).
 *  • The accent colour is read ONCE and refreshed only on a theme change via a
 *    MutationObserver — the old loop called getComputedStyle() every frame, a
 *    forced style flush 60×/s that showed up as scroll jank.
 *  • Particle count capped low; O(n²) link pass scales with it.
 *  • Pauses when the tab is hidden OR the window is unfocused (data-ambient-paused),
 *    so it never burns CPU/GPU while nobody's looking.
 */
export function ParticleField({ density = 0.00006 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let last = 0;
    const FRAME_MS = 1000 / 30;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const readAccent = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() ||
      "124 92 255";
    let color = readAccent();

    type P = { x: number; y: number; vx: number; vy: number };
    let particles: P[] = [];

    const paused = () =>
      document.hidden || document.documentElement.dataset.ambientPaused === "true";

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.floor(w * h * density));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
      }));
    }

    function frame(ts: number) {
      raf = requestAnimationFrame(frame);
      if (paused()) return;
      if (ts - last < FRAME_MS) return;
      last = ts;

      ctx!.clearRect(0, 0, w, h);
      const maxDist = 130;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }

      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < maxDist) {
            ctx!.strokeStyle = `rgb(${color} / ${(1 - dist / maxDist) * 0.12})`;
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
        ctx!.fillStyle = `rgb(${color} / 0.6)`;
        ctx!.beginPath();
        ctx!.arc(a.x, a.y, 1.4, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    // Refresh the cached colour only when the theme actually changes.
    const themeObserver = new MutationObserver(() => {
      color = readAccent();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [density]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
