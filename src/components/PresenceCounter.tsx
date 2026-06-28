"use client";

import { useEffect, useState } from "react";

// Small floating chip showing how many people are on the map right now.
// Polls /api/presence GET every 15s and renders active + recent counts in
// the cyberpunk palette to match CyberMap.tsx.

interface PresenceCounts {
  active: number;
  recent: number;
}

const ACTIVE_COLOR = "rgba(34, 211, 238, 1)"; // cyan-400
const RECENT_COLOR = "rgba(168, 85, 247, 0.7)"; // purple-500 dim

export default function PresenceCounter() {
  const [counts, setCounts] = useState<PresenceCounts | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/presence", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as {
          active: unknown[];
          recent: unknown[];
        };
        if (cancelled) return;
        setCounts({
          active: Array.isArray(d.active) ? d.active.length : 0,
          recent: Array.isArray(d.recent) ? d.recent.length : 0,
        });
      } catch {
        // ignore network errors — chip just won't update this tick
      }
    }

    poll();
    const interval = setInterval(poll, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!counts) return null;

  return (
    <div
      className="hidden sm:flex"
      style={{
        position: "fixed",
        top: 70,
        right: 16,
        zIndex: 50,
        alignItems: "center",
        gap: 10,
        padding: "5px 10px",
        background: "rgba(10, 6, 18, 0.85)",
        border: "1px solid rgba(217, 70, 239, 0.35)",
        boxShadow: "0 0 8px rgba(217, 70, 239, 0.2)",
        borderRadius: 999,
        color: "rgba(232, 215, 255, 0.85)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 10,
        letterSpacing: "0.04em",
        textTransform: "lowercase",
        pointerEvents: "none",
      }}
      aria-label={`${counts.active} active and ${counts.recent} recent visitors`}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: ACTIVE_COLOR,
            boxShadow: `0 0 6px ${ACTIVE_COLOR}`,
          }}
        />
        <span>{counts.active} active</span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: RECENT_COLOR,
          }}
        />
        <span>{counts.recent} recent</span>
      </span>
    </div>
  );
}
