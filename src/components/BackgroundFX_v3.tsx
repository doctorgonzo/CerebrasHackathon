"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
// Purple/fuchsia/blue scheme everywhere.
const HUE_BASE = 240;
const HUE_RANGE = 80;

/**
 * BackgroundFX_v3 — Matrix-style symbol rain with ambient pulse rings.
 *
 * Renders into a portal attached to document.body to bypass any stacking
 * context / overflow / isolate issues from the parent app. Uses inline
 * styles only (no Tailwind classes) so it's immune to any class-stripping
 * regression.
 *
 * Two layers, single canvas:
 *  1) Slow, drifting concentric pulse rings — give the page subtle depth.
 *  2) Falling columns of AI-ish glyphs (binary, brackets, greek letters)
 *     in purple/fuchsia/blue with a bright leading head and fading tail.
 */

// Glyph set: binary, code brackets, greek, math, AI-ish punctuation.
const GLYPHS = "01<>{}[]()/\\|+-=*#$&λΣΨΩΔΘΦπτσμ◆◇◈□■▲△▼▽◀▶♦♢";

interface RainColumn {
  x: number;
  y: number;          // current head y in CSS px
  speed: number;      // px per frame
  trail: number;      // length of tail in glyph rows
  hue: number;        // 240..320 (blue → purple → fuchsia)
  fontSize: number;   // px
  glyphs: string[];   // pre-picked glyph for each row position
  nextSwap: number;   // frame index when we shuffle a glyph
  frame: number;
}

interface PulseRing {
  x: number;
  y: number;
  r: number;
  maxR: number;
  hue: number;
  alpha: number;
}

export default function BackgroundFX_v3() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "1",
      display: "block",
    } as CSSStyleDeclaration);
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.bgfx = "v3";

    // Insert as the very first child of body so all real UI paints on top.
    document.body.insertBefore(canvas, document.body.firstChild);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let frame = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;

    let columns: RainColumn[] = [];
    const rings: PulseRing[] = [];

    // Mouse "Neo" warp field — glyphs bend around the cursor.
    const mouse = { x: -9999, y: -9999, active: false, smoothX: -9999, smoothY: -9999 };
    const WARP_RADIUS = 95;
    const WARP_STRENGTH = 0.85;

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    }
    function onMouseLeave() {
      mouse.active = false;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);

    function pickGlyph(): string {
      return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }

    function buildColumns() {
      const fontSize = Math.max(13, Math.floor(width / 110));
      const colWidth = fontSize * 1.8;
      const colCount = Math.ceil(width / colWidth);
      columns = [];
      for (let i = 0; i < colCount; i++) {
        const trail = 8 + Math.floor(Math.random() * 14);
        const glyphs: string[] = [];
        for (let g = 0; g < trail + 4; g++) glyphs.push(pickGlyph());
        columns.push({
          x: i * colWidth + colWidth / 2,
          // stagger start so all columns aren't synchronized
          y: -Math.random() * height,
          speed: 0.25 + Math.random() * 0.7,
          trail,
          hue: HUE_BASE + Math.random() * HUE_RANGE, // blue → purple → fuchsia
          fontSize,
          glyphs,
          nextSwap: Math.floor(Math.random() * 30),
          frame: 0,
        });
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      buildColumns();
    }

    function spawnRing() {
      rings.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0,
        maxR: 220 + Math.random() * 260,
        hue: HUE_BASE + Math.random() * HUE_RANGE,
        alpha: 0.08 + Math.random() * 0.05,
      });
      if (rings.length > 4) rings.shift();
    }

    function step() {
      if (!ctx) return;
      frame++;

      // Soft trail: use destination-out to fade existing pixels TOWARD
      // transparent (not toward black). This keeps the matrix canvas
      // see-through so the CyberMap layer behind it stays visible.
      // Previously we painted a translucent black rect, which accumulated
      // into a solid black layer that obscured everything underneath.
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      // ---- Pulse rings (drawn first so rain sits on top) ----
      if (frame % 180 === 0) spawnRing();
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.r += 1.4;
        const t = ring.r / ring.maxR;
        const a = ring.alpha * (1 - t);
        if (t >= 1 || a <= 0.005) {
          rings.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `hsla(${ring.hue}, 85%, 65%, ${a})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();

        // soft inner halo
        const haloA = a * 0.35;
        if (haloA > 0.01) {
          ctx.strokeStyle = `hsla(${ring.hue}, 95%, 75%, ${haloA})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ---- Glyph rain ----
      for (const col of columns) {
        col.frame++;
        col.y += col.speed;

        // Occasionally swap a glyph somewhere in the trail for that
        // signature shimmering / scrambling look.
        if (col.frame >= col.nextSwap) {
          const swapIdx = Math.floor(Math.random() * col.glyphs.length);
          col.glyphs[swapIdx] = pickGlyph();
          col.nextSwap = col.frame + 4 + Math.floor(Math.random() * 18);
        }

        const fs = col.fontSize;
        ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = "top";

        const headIdx = Math.floor(col.y / fs);
        // Draw the trail from oldest (top, dimmest) to newest (head, bright).
        for (let i = 0; i < col.trail; i++) {
          const rowIdx = headIdx - i;
          const yPos = rowIdx * fs;
          if (yPos < -fs || yPos > height) continue;

          // Neo warp: push glyphs radially outward from cursor when near.
          let drawX = col.x - fs / 2;
          let drawY = yPos;
          if (mouse.active) {
            const dx = col.x - mouse.x;
            const dy = yPos - mouse.y;
            const dist = Math.hypot(dx, dy);
            if (dist < WARP_RADIUS && dist > 0.1) {
              const t = 1 - dist / WARP_RADIUS;
              // Smoothed force: strongest near the cursor, eases to 0 at radius.
              const force = t * t * WARP_RADIUS * WARP_STRENGTH;
              drawX += (dx / dist) * force;
              drawY += (dy / dist) * force;
            }
          }

          const glyphIdx = ((rowIdx % col.glyphs.length) + col.glyphs.length) % col.glyphs.length;
          const glyph = col.glyphs[glyphIdx];

          if (i === 0) {
            // Dim leading head — soft colored glow, not white.
            ctx.shadowBlur = 6;
            ctx.shadowColor = `hsla(${col.hue}, 80%, 55%, 0.4)`;
            ctx.fillStyle = `hsla(${col.hue}, 70%, 75%, 0.55)`;
          } else {
            ctx.shadowBlur = 0;
            // Fade tail: closer to head = brighter.
            const t = 1 - i / col.trail;
            const alpha = Math.max(0, t * 0.35);
            ctx.fillStyle = `hsla(${col.hue}, 80%, ${40 + t * 20}%, ${alpha})`;
          }
          ctx.fillText(glyph, drawX, drawY);
        }
        ctx.shadowBlur = 0;

        // Reset column when fully off the bottom (with some random offset
        // so columns don't all reset at the same moment).
        if (col.y - col.trail * fs > height) {
          col.y = -Math.random() * height * 0.5;
          col.speed = 0.25 + Math.random() * 0.7;
          col.hue = HUE_BASE + Math.random() * HUE_RANGE;
          col.trail = 8 + Math.floor(Math.random() * 14);
        }
      }

      raf = requestAnimationFrame(step);
    }

    resize();
    // Prime a couple of rings so the page isn't bare on first paint.
    spawnRing();
    spawnRing();

    const handleResize = () => resize();
    window.addEventListener("resize", handleResize);

    // Pause when tab is hidden to save battery.
    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        raf = requestAnimationFrame(step);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [mounted]);

  if (!mounted) return null;

  // Render a tiny portal marker so we have a footprint in the React tree,
  // but the actual canvas is appended imperatively above (so we can fully
  // control its position in the DOM and its stacking).
  return createPortal(
    <div
      aria-hidden
      data-bgfx-marker="v3"
      style={{ display: "none" }}
    />,
    document.body,
  );
}
