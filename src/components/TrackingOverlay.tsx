"use client";

import { useEffect, useRef } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

interface TrackingOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
}

// Tracking HUD with two layers:
//  1. MOTION — downsample the live video, diff each frame, cluster moving
//     cells into boxes, draw security-cam green brackets. No model, reacts to
//     anything that moves.
//  2. FACES — MediaPipe BlazeFace locks cyan brackets onto faces in frame.
const GRID_W = 64;
const GRID_H = 36;
const DIFF_THRESHOLD = 26; // luminance delta counted as motion
const MIN_CELLS = 10; // ignore tiny noise blobs
const MAX_BOXES = 3;
const DETECT_INTERVAL_MS = 80;
const HOLD_MS = 380; // keep a lock briefly after motion stops
const FACE_HOLD_MS = 300; // keep a face lock briefly between detections
const SMOOTH = 0.3;
const TRACK_COLOR = "#39ff14";
const FACE_COLOR = "#06b6d4"; // cyan, matches the Eyes theme

// Keep the wasm version in lockstep with the installed package (package.json).
const MP_VERSION = "0.10.35";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

interface GridBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
}
interface DispBox {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  conf: number;
}

// Lerp the displayed boxes toward the latest targets (called every frame).
function smoothBoxes(displayed: DispBox[], targets: DispBox[]): DispBox[] {
  const next: DispBox[] = [];
  for (let i = 0; i < targets.length; i++) {
    const tb = targets[i];
    const p = displayed[i];
    if (p) {
      next.push({
        x: p.x + (tb.x - p.x) * SMOOTH,
        y: p.y + (tb.y - p.y) * SMOOTH,
        w: p.w + (tb.w - p.w) * SMOOTH,
        h: p.h + (tb.h - p.h) * SMOOTH,
        alpha: p.alpha + (1 - p.alpha) * 0.2,
        conf: tb.conf,
      });
    } else {
      next.push({ ...tb, alpha: 0.25 });
    }
  }
  return next;
}

// 4-connected flood fill over the active-cell grid → bounding boxes.
function clusterBoxes(active: Uint8Array): GridBox[] {
  const seen = new Uint8Array(GRID_W * GRID_H);
  const boxes: GridBox[] = [];
  const stack: number[] = [];
  for (let s = 0; s < active.length; s++) {
    if (!active[s] || seen[s]) continue;
    stack.length = 0;
    stack.push(s);
    seen[s] = 1;
    let x0 = GRID_W,
      y0 = GRID_H,
      x1 = 0,
      y1 = 0,
      count = 0;
    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % GRID_W;
      const y = (idx / GRID_W) | 0;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && active[idx - 1] && !seen[idx - 1]) {
        seen[idx - 1] = 1;
        stack.push(idx - 1);
      }
      if (x < GRID_W - 1 && active[idx + 1] && !seen[idx + 1]) {
        seen[idx + 1] = 1;
        stack.push(idx + 1);
      }
      if (y > 0 && active[idx - GRID_W] && !seen[idx - GRID_W]) {
        seen[idx - GRID_W] = 1;
        stack.push(idx - GRID_W);
      }
      if (y < GRID_H - 1 && active[idx + GRID_W] && !seen[idx + GRID_W]) {
        seen[idx + GRID_W] = 1;
        stack.push(idx + GRID_W);
      }
    }
    if (count >= MIN_CELLS) boxes.push({ x0, y0, x1, y1, count });
  }
  boxes.sort((a, b) => b.count - a.count);
  return boxes.slice(0, MAX_BOXES);
}

function bracket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  len: number,
  alpha: number,
  color: string,
): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  ctx.moveTo(x, y + h - len);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + len, y + h);
  ctx.moveTo(x + w - len, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// Draw one set of bracketed boxes (motion or face) in a given color/prefix.
function drawBoxes(
  ctx: CanvasRenderingContext2D,
  boxes: DispBox[],
  color: string,
  prefix: string,
): void {
  boxes.forEach((b, i) => {
    const len = Math.max(8, Math.min(b.w, b.h) * 0.22);
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    bracket(ctx, b.x, b.y, b.w, b.h, len, b.alpha, color);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = b.alpha * 0.15;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.globalAlpha = b.alpha;
    ctx.fillStyle = color;
    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    const label = `${prefix}-0${i + 1}  ${b.conf}%`;
    const ly = b.y > 14 ? b.y - 4 : b.y + b.h + 12;
    ctx.fillText(label, b.x, ly);
    ctx.restore();
  });
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  motion: DispBox[],
  faces: DispBox[],
  t: number,
): void {
  // drifting scanline
  const scanY = (t / 16) % H;
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = TRACK_COLOR;
  ctx.fillRect(0, scanY, W, 2);
  ctx.restore();

  drawBoxes(ctx, motion, TRACK_COLOR, "TGT");
  drawBoxes(ctx, faces, FACE_COLOR, "FACE");

  // top-left status with blinking REC dot
  const blink = Math.sin(t / 200) > 0;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = blink ? "#ef4444" : "rgba(239,68,68,0.3)";
  ctx.beginPath();
  ctx.arc(12, 13, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TRACK_COLOR;
  ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `TRACKING · ${motion.length} TGT · ${faces.length} FACE`,
    22,
    17,
  );
  ctx.restore();
}

export default function TrackingOverlay({
  videoRef,
  active,
}: TrackingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const off = document.createElement("canvas");
    off.width = GRID_W;
    off.height = GRID_H;
    const octx = off.getContext("2d", { willReadFrequently: true });
    if (!octx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let lastDetect = 0;
    let lastFound = 0;
    let lastFace = 0;
    let prev: Float32Array | null = null;
    let targets: DispBox[] = [];
    let displayed: DispBox[] = [];
    let faceTargets: DispBox[] = [];
    let displayedFaces: DispBox[] = [];

    // MediaPipe face detector — loaded async. Until it's ready (or if loading
    // fails, e.g. offline), the motion layer just runs on its own.
    let faceDetector: FaceDetector | null = null;
    let disposed = false;
    (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        const detector = await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
        });
        if (disposed) detector.close();
        else faceDetector = detector;
      } catch {
        try {
          // Some machines lack a working GPU delegate — retry on CPU.
          const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
          const detector = await FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
            runningMode: "VIDEO",
          });
          if (disposed) detector.close();
          else faceDetector = detector;
        } catch {
          // give up on faces; motion layer still works
        }
      }
    })();

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!video.videoWidth) return;
      const rect = video.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;
      if (cssW < 2 || cssH < 2) return;

      if (
        canvas.width !== Math.round(cssW * dpr) ||
        canvas.height !== Math.round(cssH * dpr)
      ) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      if (t - lastDetect > DETECT_INTERVAL_MS) {
        lastDetect = t;
        octx.drawImage(video, 0, 0, GRID_W, GRID_H);
        const img = octx.getImageData(0, 0, GRID_W, GRID_H).data;
        const luma = new Float32Array(GRID_W * GRID_H);
        for (let i = 0; i < luma.length; i++) {
          luma[i] =
            0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
        }
        if (prev) {
          const act = new Uint8Array(GRID_W * GRID_H);
          for (let i = 0; i < luma.length; i++) {
            if (Math.abs(luma[i] - prev[i]) > DIFF_THRESHOLD) act[i] = 1;
          }
          const found = clusterBoxes(act);
          if (found.length > 0) {
            lastFound = t;
            targets = found.map((b) => {
              const nx0 = b.x0 / GRID_W;
              const nx1 = (b.x1 + 1) / GRID_W;
              const ny0 = b.y0 / GRID_H;
              const ny1 = (b.y1 + 1) / GRID_H;
              // mirror x to match the CSS-mirrored (selfie) video
              const mx0 = 1 - nx1;
              const mx1 = 1 - nx0;
              return {
                x: mx0 * cssW,
                y: ny0 * cssH,
                w: (mx1 - mx0) * cssW,
                h: (ny1 - ny0) * cssH,
                alpha: 1,
                conf: Math.min(99, 60 + Math.round(b.count * 1.1)),
              };
            });
          } else if (t - lastFound > HOLD_MS) {
            targets = [];
          }
        }
        prev = luma;

        // Face layer: BlazeFace on the full-res frame. Box coords come back in
        // the video's intrinsic pixels, so normalize then mirror like motion.
        if (faceDetector) {
          try {
            const res = faceDetector.detectForVideo(video, t);
            const dets = res.detections ?? [];
            if (dets.length > 0) {
              lastFace = t;
              faceTargets = dets.map((d) => {
                const bb = d.boundingBox!;
                const nx0 = bb.originX / video.videoWidth;
                const nx1 = (bb.originX + bb.width) / video.videoWidth;
                const ny0 = bb.originY / video.videoHeight;
                const ny1 = (bb.originY + bb.height) / video.videoHeight;
                const mx0 = 1 - nx1;
                const mx1 = 1 - nx0;
                return {
                  x: mx0 * cssW,
                  y: ny0 * cssH,
                  w: (mx1 - mx0) * cssW,
                  h: (ny1 - ny0) * cssH,
                  alpha: 1,
                  conf: Math.round((d.categories?.[0]?.score ?? 0) * 100),
                };
              });
            } else if (t - lastFace > FACE_HOLD_MS) {
              faceTargets = [];
            }
          } catch {
            // skip this frame's face pass
          }
        }
      }

      // Smooth both layers toward their latest targets every frame.
      displayed = smoothBoxes(displayed, targets);
      displayedFaces = smoothBoxes(displayedFaces, faceTargets);

      drawHud(ctx, cssW, cssH, displayed, displayedFaces, t);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      faceDetector?.close();
    };
  }, [active, videoRef]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
