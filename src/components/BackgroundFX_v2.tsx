"use client";

/**
 * BackgroundFX_v2 — bulletproof animated background
 *
 * Strategy: mount as a fixed-position layer DIRECTLY inside <body> (not inside
 * any page <div> that might create a stacking context or paint solid). The
 * page content wrapper should sit at z-index >= 1 so this layer (z-index 0)
 * shows through where the wrapper is transparent.
 *
 * Rendering: pure CSS animated gradient blobs (always visible, GPU-cheap)
 * + a single overlay <canvas> for mouse-move ripples. No React Flow conflicts,
 * no isolate stacking context shenanigans.
 *
 * IMPORTANT: relies on layout.tsx mounting this OUTSIDE the page content tree
 * and on the root content wrapper being `bg-transparent`. The component does
 * not use `isolate`, does not set its own `z-index` higher than 0, and uses
 * `pointer-events: none` so it never steals input from the app.
 */

import { useEffect, useRef } from "react";

interface Ripple {
  x: number;
  y: number;
  r: number;
  alpha: number;
  hue: number;
  born: number;
}

export default function BackgroundFXv2() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR for perf
    let w = window.innerWidth;
    let h = window.innerHeight;
    const ripples: Ripple[] = [];
    let lastRippleAt = 0;
    const mouse = { x: -9999, y: -9999, active: false };
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      if (!canvas || !ctx) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      const now = performance.now();
      // Throttle ripple emission to every ~60ms so fast moves don't flood
      if (now - lastRippleAt > 60) {
        lastRippleAt = now;
        // 3 hue families: purple (270), fuchsia (300), blue (220)
        const palette = [270, 300, 220, 285];
        const hue = palette[Math.floor(Math.random() * palette.length)];
        ripples.push({
          x: e.clientX,
          y: e.clientY,
          r: 6,
          alpha: 0.65,
          hue,
          born: now,
        });
        // Hard cap so we never balloon
        if (ripples.length > 40) {
          ripples.splice(0, ripples.length - 40);
        }
      }
    }

    function onLeave() {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    }

    function onTouch(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      onMove({ clientX: t.clientX, clientY: t.clientY } as MouseEvent);
    }

    function step() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Iterate ripples, animate outward
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 3.2;
        rp.alpha *= 0.965;
        if (rp.alpha < 0.012 || rp.r > Math.max(w, h)) {
          ripples.splice(i, 1);
          continue;
        }
        // Outer ring
        ctx.strokeStyle = `hsla(${rp.hue}, 95%, 70%, ${rp.alpha})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.stroke();
        // Inner softer ring for depth
        ctx.strokeStyle = `hsla(${rp.hue}, 90%, 80%, ${rp.alpha * 0.5})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, Math.max(0, rp.r - 6), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Soft glow that follows the cursor — only when active
      if (mouse.active) {
        const grad = ctx.createRadialGradient(
          mouse.x,
          mouse.y,
          0,
          mouse.x,
          mouse.y,
          180,
        );
        grad.addColorStop(0, "hsla(285, 95%, 70%, 0.18)");
        grad.addColorStop(0.5, "hsla(270, 90%, 60%, 0.08)");
        grad.addColorStop(1, "hsla(270, 90%, 60%, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 180, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(step);
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });

    if (!reduceMotion) {
      raf = requestAnimationFrame(step);
    } else {
      // Still draw one frame so static decoration shows; CSS handles the rest
      step();
      cancelAnimationFrame(raf);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchstart", onTouch);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      // Pure inline styles to avoid Tailwind compilation surprises and ensure
      // these critical positioning rules are applied no matter what.
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        // The base dark color is on <html>; we paint over it.
        background:
          // A subtle vignette so blobs feel grounded, not floating in pure black.
          "radial-gradient(ellipse at top, rgba(88, 28, 135, 0.18) 0%, rgba(9, 9, 11, 0) 60%), radial-gradient(ellipse at bottom, rgba(30, 64, 175, 0.15) 0%, rgba(9, 9, 11, 0) 60%)",
      }}
    >
      {/* Three animated CSS gradient blobs — guaranteed to render, no JS needed */}
      <div
        style={{
          position: "absolute",
          top: "-15%",
          left: "-10%",
          width: "60vw",
          height: "60vw",
          maxWidth: "900px",
          maxHeight: "900px",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(168, 85, 247, 0.35) 0%, rgba(168, 85, 247, 0) 65%)",
          filter: "blur(20px)",
          animation: "bgfx-float-a 22s ease-in-out infinite",
          willChange: "transform",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-20%",
          right: "-15%",
          width: "70vw",
          height: "70vw",
          maxWidth: "1000px",
          maxHeight: "1000px",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(217, 70, 239, 0.32) 0%, rgba(217, 70, 239, 0) 65%)",
          filter: "blur(20px)",
          animation: "bgfx-float-b 28s ease-in-out infinite",
          willChange: "transform",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "30%",
          left: "40%",
          width: "55vw",
          height: "55vw",
          maxWidth: "800px",
          maxHeight: "800px",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, rgba(59, 130, 246, 0) 65%)",
          filter: "blur(20px)",
          animation: "bgfx-float-c 34s ease-in-out infinite",
          willChange: "transform",
        }}
      />

      {/* Subtle animated grid for depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.18,
          backgroundImage:
            "linear-gradient(rgba(168, 85, 247, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(168, 85, 247, 0.12) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          animation: "bgfx-grid-drift 60s linear infinite",
        }}
      />

      {/* Noise/grain via SVG — masks banding in the gradients */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.06,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Canvas for mouse ripples — sits on top of CSS layers, still inside this wrapper */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />

      {/* Component-scoped keyframes — injected via <style> so they don't fight Tailwind v4 */}
      <style>{`
        @keyframes bgfx-float-a {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(80px, 60px) scale(1.08); }
          66% { transform: translate(-40px, 100px) scale(0.96); }
        }
        @keyframes bgfx-float-b {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(-90px, -70px) scale(1.12); }
          66% { transform: translate(60px, -40px) scale(0.94); }
        }
        @keyframes bgfx-float-c {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-40%, -55%) scale(1.15); }
        }
        @keyframes bgfx-grid-drift {
          0% { background-position: 0 0; }
          100% { background-position: 60px 60px; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-bgfx-blob] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
