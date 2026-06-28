"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  hue: number;
}

const PARTICLE_COUNT = 90;
const CONNECT_DIST = 140;
const MOUSE_INFLUENCE = 180;

export default function BackgroundFX() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let dpr = window.devicePixelRatio || 1;
    let width = window.innerWidth;
    let height = window.innerHeight;
    const mouse = { x: -1000, y: -1000, active: false };
    const ripples: Ripple[] = [];
    const particles: Particle[] = [];
    let lastRippleAt = 0;

    function resize() {
      if (!canvas || !ctx) return;
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    function init() {
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          size: 1 + Math.random() * 2,
          hue: 260 + Math.random() * 80, // purple → fuchsia → blue
        });
      }
    }

    function onMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      const now = performance.now();
      if (now - lastRippleAt > 70) {
        lastRippleAt = now;
        ripples.push({
          x: e.clientX,
          y: e.clientY,
          radius: 4,
          alpha: 0.7,
          hue: 270 + Math.random() * 60,
        });
        if (ripples.length > 30) ripples.splice(0, ripples.length - 30);
      }
    }

    function onLeave() {
      mouse.active = false;
      mouse.x = -1000;
      mouse.y = -1000;
    }

    function step() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      // Update particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        p.x = Math.max(0, Math.min(width, p.x));
        p.y = Math.max(0, Math.min(height, p.y));

        // Mouse attraction
        if (mouse.active) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MOUSE_INFLUENCE && dist > 0.1) {
            const force = (1 - dist / MOUSE_INFLUENCE) * 0.08;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }
        // Velocity damping so things don't fly off
        p.vx *= 0.985;
        p.vy *= 0.985;
        // Re-energize if too slow
        if (Math.hypot(p.vx, p.vy) < 0.05) {
          p.vx += (Math.random() - 0.5) * 0.1;
          p.vy += (Math.random() - 0.5) * 0.1;
        }
      }

      // Draw connection lines
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < CONNECT_DIST) {
            const alpha = (1 - dist / CONNECT_DIST) * 0.35;
            const avgHue = (a.hue + b.hue) / 2;
            ctx.strokeStyle = `hsla(${avgHue}, 80%, 65%, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Draw mouse-particle lines (extra emphasis near cursor)
      if (mouse.active) {
        for (const p of particles) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MOUSE_INFLUENCE) {
            const alpha = (1 - dist / MOUSE_INFLUENCE) * 0.6;
            ctx.strokeStyle = `hsla(${p.hue}, 95%, 75%, ${alpha})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(mouse.x, mouse.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        const near = mouse.active && dist < MOUSE_INFLUENCE;
        const size = near ? p.size * 2 : p.size;
        const alpha = near ? 1 : 0.7;
        ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();

        if (near) {
          // Glow halo
          ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, 0.15)`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += 2.6;
        r.alpha *= 0.96;
        if (r.alpha < 0.01) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `hsla(${r.hue}, 95%, 70%, ${r.alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(step);
    }

    resize();
    init();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
      />
      <div
        style={{
          position: "fixed",
          top: 8,
          right: 8,
          background: "#ff0000",
          color: "#fff",
          padding: "4px 8px",
          fontSize: 11,
          fontFamily: "monospace",
          zIndex: 9999,
          borderRadius: 4,
        }}
      >
        BackgroundFX mounted
      </div>
    </>
  );
}
