"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileAttachment } from "@/lib/types";
import TrackingOverlay from "./TrackingOverlay";

interface WebcamPanelProps {
  // Fires a single frozen frame into the swarm ("Stare"). An optional question
  // lets the user ask something specific about the frame; empty = general read.
  onStare: (frame: FileAttachment, question?: string) => void;
  isRunning: boolean;
}

// Cap the captured frame width to keep vision token cost (and upload size)
// sane. 1024px is plenty for Gemma/Claude to read a scene.
const MAX_FRAME_WIDTH = 1024;

export default function WebcamPanel({ onStare, isRunning }: WebcamPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [question, setQuestion] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia unavailable (needs https or localhost)");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setActive(true);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera blocked. Allow camera access in your browser, then retry."
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "No camera found."
            : err instanceof Error
              ? err.message
              : "Couldn't start the camera.",
      );
    } finally {
      setStarting(false);
    }
  }, []);

  // Stop the camera when the component unmounts so the LED turns off.
  useEffect(() => () => stopCamera(), [stopCamera]);

  // Grab the current video frame, downscale, and return it as a JPEG
  // FileAttachment — exactly the shape the existing /api/spawn file flow
  // (Extractor -> Brain -> swarm) already consumes.
  const captureFrame = useCallback((): FileAttachment | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    return {
      data: base64,
      mediaType: "image/jpeg",
      name: `hive-frame-${Date.now()}.jpg`,
    };
  }, []);

  const handleStare = useCallback(() => {
    const frame = captureFrame();
    if (!frame) return;
    // Quick shutter flash so the capture feels tactile on stage.
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    onStare(frame, question.trim() || undefined);
  }, [captureFrame, onStare, question]);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="relative rounded-2xl overflow-hidden border border-cyan-500/30 bg-black/40 aspect-video">
        {/* Live preview. Mirrored so it feels like a mirror on stage. */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-200 ${
            active ? "opacity-100" : "opacity-0"
          }`}
        />

        <TrackingOverlay videoRef={videoRef} active={active} />

        {/* Shutter flash overlay */}
        {flash && <div className="absolute inset-0 bg-white/80 animate-fade-in" />}

        {/* Idle / error state */}
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-4xl">{"\u{1F441}\u{FE0F}"}</div>
            {error ? (
              <p className="text-red-300/80 text-xs max-w-xs">{error}</p>
            ) : (
              <p className="text-cyan-200/50 text-xs max-w-xs">
                Show the Hive what you&apos;re looking at. It&apos;ll spawn a
                swarm of agents to make sense of the scene.
              </p>
            )}
            <button
              type="button"
              onClick={startCamera}
              disabled={starting}
              className="mt-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-all flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full bg-white/90" />
              {starting ? "Starting camera…" : error ? "Retry camera" : "Start camera"}
            </button>
          </div>
        )}

        {/* Live badge */}
        {active && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-cyan-500/40 text-[10px] font-mono uppercase tracking-widest text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            live
          </div>
        )}
      </div>

      {/* Optional question — ask something specific about the frame. */}
      {active && (
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isRunning) handleStare();
          }}
          disabled={isRunning}
          placeholder="Optional: ask about what you're showing… (e.g. “is this safe to eat?”)"
          className="w-full mt-3 px-4 py-2.5 bg-black/30 border border-cyan-500/30 focus:border-cyan-400/60 focus:outline-none rounded-lg text-sm text-white placeholder:text-cyan-200/30 disabled:opacity-40"
        />
      )}

      {/* Controls */}
      {active && (
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleStare}
            disabled={isRunning}
            className="flex-1 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-white/5 disabled:text-white/20 text-white font-semibold rounded-lg transition-all text-sm flex items-center justify-center gap-2"
          >
            <span className="text-base">{"\u{1F441}\u{FE0F}"}</span>
            {isRunning
              ? "Swarm is staring…"
              : question.trim()
                ? "Ask the swarm"
                : "Stare — unleash the swarm"}
          </button>
          <button
            type="button"
            onClick={stopCamera}
            disabled={isRunning}
            title="Turn the camera off"
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white/90 disabled:opacity-30 rounded-lg transition-all text-sm"
          >
            Stop cam
          </button>
        </div>
      )}
    </div>
  );
}
