"use client";

import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { AgentNode, MODEL_LABELS, ModelTier, SPECIALTY_LABELS, SPECIALTY_EMOJI } from "@/lib/types";

const tierAccent: Record<ModelTier, { text: string; bg: string }> = {
  opus: { text: "text-purple-400", bg: "bg-purple-500" },
  sonnet: { text: "text-blue-400", bg: "bg-blue-500" },
  haiku: { text: "text-emerald-400", bg: "bg-emerald-500" },
};

interface DetailPanelProps {
  agent: AgentNode | null;
  onClose: () => void;
}

export default function DetailPanel({ agent, onClose }: DetailPanelProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!agent) return null;

  const accent = tierAccent[agent.model];

  return (
    <div className="absolute right-0 top-0 h-full w-[340px] bg-zinc-900/95 backdrop-blur-md border-l border-white/10 z-50 flex flex-col animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              agent.customSpecialist
                ? "bg-fuchsia-500"
                : agent.specialty
                  ? "bg-amber-500"
                  : accent.bg
            }`}
          />
          <span
            className={`text-xs font-bold uppercase tracking-wider ${
              agent.customSpecialist
                ? "text-fuchsia-300"
                : agent.specialty
                  ? "text-amber-400"
                  : accent.text
            }`}
          >
            {agent.customSpecialist
              ? `${agent.customSpecialist.emoji} ${agent.customSpecialist.name || "self-naming..."}`
              : agent.specialty
                ? `${SPECIALTY_EMOJI[agent.specialty]} ${SPECIALTY_LABELS[agent.specialty]}`
                : MODEL_LABELS[agent.model]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-2 py-1 rounded transition-all"
        >
          ESC
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {agent.customSpecialist && (
          <div className="bg-gradient-to-br from-fuchsia-950/60 to-pink-950/60 border border-fuchsia-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{agent.customSpecialist.emoji}</span>
              <span className="text-fuchsia-200 font-bold text-sm">
                {agent.customSpecialist.name || "(picking a name...)"}
              </span>
            </div>
            <div className="text-fuchsia-100/80 text-xs italic leading-relaxed">
              {agent.customSpecialist.role}
            </div>
          </div>
        )}

        {/* Agent name + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="text-white font-semibold text-lg leading-tight">
            {agent.label}
          </div>
          <div className="flex items-center gap-1.5 flex-none mt-1">
            <div
              className={`w-2 h-2 rounded-full ${
                agent.status === "complete"
                  ? "bg-emerald-400"
                  : agent.status === "error"
                    ? "bg-red-400"
                    : "bg-yellow-400 animate-pulse"
              }`}
            />
            <span className="text-white/50 text-xs capitalize">
              {agent.status}
            </span>
          </div>
        </div>

        {/* Depth indicator */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i <= agent.depth
                  ? `${accent.bg} w-6`
                  : "bg-white/10 w-4"
              }`}
            />
          ))}
          <span className="text-white/30 text-[10px] ml-1">
            depth {agent.depth}
          </span>
        </div>

        {/* Assigned task */}
        <div>
          <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5 font-medium">
            Assigned Task
          </div>
          <div className="text-white/70 text-sm leading-relaxed bg-white/5 rounded-lg p-3 border border-white/5">
            {agent.task}
          </div>
        </div>

        {/* Result */}
        {agent.result && (
          <div>
            <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5 font-medium">
              Output
            </div>
            <div className="bg-white/5 rounded-lg p-3 border border-white/5 max-h-[50vh] overflow-y-auto">
              <div className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-strong:text-white/90 prose-p:text-white/70 prose-li:text-white/70 prose-code:text-purple-300 prose-hr:border-white/10">
                <ReactMarkdown>{agent.result}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
