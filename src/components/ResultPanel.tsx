"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ProposedAction, WORKER_ROLES } from "@/lib/types";
import ActionsPanel from "@/components/ActionsPanel";

interface SpecialistResult {
  label: string;
  emoji?: string;
  role?: string;
  result: string;
}

interface ResultPanelProps {
  result: string | null;
  agentCount: number;
  onClose: () => void;
  onExport?: () => void;
  totalCost: number;
  elapsedMs: number;
  humanMinutes: number;
  role: string;
  actions?: ProposedAction[];
  soloResult?: string | null;
  soloElapsedMs?: number | null;
  specialistResults?: SpecialistResult[];
}

export default function ResultPanel({
  result,
  agentCount,
  onClose,
  onExport,
  totalCost,
  elapsedMs,
  humanMinutes,
  role,
  actions = [],
  soloResult,
  soloElapsedMs,
  specialistResults = [],
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  if (!result) return null;

  function handleCopy() {
    navigator.clipboard.writeText(result!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleEmail() {
    const subject = encodeURIComponent("agentSpam — AI Synthesis Results");
    const body = encodeURIComponent(result!);
    window.open(`mailto:?subject=${subject}&body=${body}`);
  }

  const selectedRole = WORKER_ROLES.find((r) => r.id === role);
  const showComparison =
    selectedRole && selectedRole.hourlyRate > 0 && humanMinutes > 0;
  const humanCost = showComparison
    ? (humanMinutes / 60) * selectedRole.hourlyRate
    : 0;
  const savingsPct = showComparison
    ? Math.max(0, Math.min(99.99, (1 - totalCost / humanCost) * 100))
    : 0;
  const timesFaster =
    elapsedMs > 0 ? Math.round(((humanMinutes * 60 * 1000) / elapsedMs) * 10) / 10 : 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col bg-zinc-900 border border-purple-500/30 rounded-2xl shadow-2xl shadow-purple-500/10 overflow-hidden animate-overlay-in">
        <div className="absolute inset-0 animate-shimmer rounded-2xl pointer-events-none" />
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 flex-none relative z-10">
          <div className="w-3 h-3 rounded-full bg-purple-400 animate-pulse" />
          <span className="text-purple-300 text-sm font-bold uppercase tracking-wider">
            Final Synthesis
          </span>
          <span className="text-white/30 text-xs ml-2">
            {agentCount} agents contributed
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleEmail}
              className="text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Email
            </button>
            {onExport && (
              <button
                onClick={onExport}
                className="text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-all"
              >
                Export Report
              </button>
            )}
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Back to tree
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6 relative z-10">
          {showComparison && (
            <div className="mb-6 p-4 bg-gradient-to-br from-emerald-950/60 to-emerald-900/30 border border-emerald-500/30 rounded-xl">
              <div className="text-emerald-300/80 text-[10px] uppercase tracking-widest font-bold mb-3">
                Headcount Replacement Math
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <div className="text-white/40 text-xs mb-1">This run (AI)</div>
                  <div className="text-emerald-200 text-xl font-mono font-bold">
                    ${totalCost.toFixed(4)}
                  </div>
                  <div className="text-white/40 text-xs">
                    in {(elapsedMs / 1000).toFixed(1)}s
                  </div>
                </div>
                <div>
                  <div className="text-white/40 text-xs mb-1">
                    1 {selectedRole.label} @ ${selectedRole.hourlyRate}/hr
                  </div>
                  <div className="text-rose-300 text-xl font-mono font-bold line-through decoration-rose-500/50">
                    ${humanCost.toFixed(2)}
                  </div>
                  <div className="text-white/40 text-xs">
                    in ~{humanMinutes}min
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-emerald-500/20 flex items-center justify-between">
                <div>
                  <span className="text-emerald-200 text-2xl font-bold font-mono">
                    {savingsPct.toFixed(2)}%
                  </span>
                  <span className="text-emerald-300/70 text-sm ml-1">cheaper</span>
                </div>
                <div>
                  <span className="text-emerald-200 text-2xl font-bold font-mono">
                    {timesFaster}x
                  </span>
                  <span className="text-emerald-300/70 text-sm ml-1">faster</span>
                </div>
                <div className="text-emerald-300/80 text-xs italic">
                  {selectedRole.emoji} {selectedRole.label.toLowerCase()} on notice
                </div>
              </div>
            </div>
          )}

          {soloResult ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
              <div className="bg-purple-950/30 border border-purple-500/30 rounded-xl p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-purple-300 text-[10px] uppercase tracking-widest font-bold">
                    {agentCount} agents · ${totalCost.toFixed(4)}
                  </div>
                  <div className="text-purple-200/60 text-[10px] font-mono">
                    {(elapsedMs / 1000).toFixed(1)}s
                  </div>
                </div>
                <div className="prose prose-invert prose-sm max-w-none prose-headings:text-purple-200 prose-strong:text-white prose-p:text-white/80 prose-p:leading-relaxed prose-li:text-white/80 prose-code:text-purple-300 prose-hr:border-white/10 prose-a:text-purple-400">
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
              </div>
              <div className="bg-zinc-800/40 border border-zinc-500/30 rounded-xl p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-zinc-300 text-[10px] uppercase tracking-widest font-bold">
                    Solo {process.env.NEXT_PUBLIC_FOIL_MODEL || "Gemma"} · same prompt, no tree
                  </div>
                  <div className="text-zinc-300/60 text-[10px] font-mono">
                    {soloElapsedMs ? `${(soloElapsedMs / 1000).toFixed(1)}s` : ""}
                  </div>
                </div>
                <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-200 prose-strong:text-white prose-p:text-white/70 prose-p:leading-relaxed prose-li:text-white/70 prose-code:text-zinc-300 prose-hr:border-white/10 prose-a:text-zinc-300">
                  <ReactMarkdown>{soloResult}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div className="prose prose-invert prose-base max-w-none prose-headings:text-purple-200 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-strong:text-white prose-p:text-white/80 prose-p:leading-relaxed prose-li:text-white/80 prose-code:text-purple-300 prose-hr:border-white/10 prose-a:text-purple-400">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          )}

          {specialistResults.length > 0 && (
            <div className="mt-6 pt-5 border-t border-white/10">
              <button
                onClick={() => setShowDetails((v) => !v)}
                className="text-purple-300 hover:text-purple-200 text-xs font-mono uppercase tracking-widest bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 px-3 py-1.5 rounded-lg transition-all"
              >
                {showDetails
                  ? "Hide agent findings"
                  : `Show all agent findings (${specialistResults.length})`}
              </button>
              {showDetails && (
                <div className="mt-4 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {specialistResults.map((sr, i) => (
                    <div
                      key={`${sr.label}-${i}`}
                      className="bg-white/[0.03] border border-white/10 rounded-xl p-4"
                    >
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
                        {sr.emoji && (
                          <span className="text-base leading-none">{sr.emoji}</span>
                        )}
                        <div className="text-purple-300 text-[10px] uppercase tracking-widest font-bold">
                          {sr.label}
                        </div>
                        {sr.role && (
                          <div className="text-white/30 text-[10px] uppercase tracking-wider">
                            · {sr.role}
                          </div>
                        )}
                      </div>
                      <div className="prose prose-invert prose-sm max-w-none prose-headings:text-purple-200 prose-strong:text-white prose-p:text-white/75 prose-p:leading-relaxed prose-li:text-white/75 prose-code:text-purple-300 prose-hr:border-white/10 prose-a:text-purple-400">
                        <ReactMarkdown>{sr.result}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {actions.length > 0 && (
            <div className="mt-6">
              <ActionsPanel actions={actions} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
