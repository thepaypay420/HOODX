"use client";

import { useEffect, useRef } from "react";

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.8,
    }));
    let raf = 0;
    const draw = () => {
      const { innerWidth: w, innerHeight: h } = window;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.y += 0.00035 * s.z;
        if (s.y > 1) s.y = 0;
        ctx.fillStyle = `rgba(180, 240, 255, ${0.15 + s.z * 0.55})`;
        ctx.fillRect(s.x * w, s.y * h, s.z * 1.6, s.z * 1.6);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 -z-10 opacity-70" />;
}
