"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentNode,
  AgentEvent,
  FileAttachment,
  MissionMode,
  MISSION_MODES,
  ProposedAction,
  WORKER_ROLES,
} from "@/lib/types";
import {
  MemoryEntry,
  getMemory,
  addMemoryEntry,
  removeMemoryEntry,
  clearMemory,
  formatMemoryForBrain,
} from "@/lib/memory";
import { generateHtmlReport } from "@/lib/report";
import { spawnSound, thinkingSound, completeSound, errorSound, synthesisSound } from "@/lib/sounds";
import AgentTree from "@/components/AgentTree";
import InputPanel from "@/components/InputPanel";
import WebcamPanel from "@/components/WebcamPanel";
import ResultPanel from "@/components/ResultPanel";
import DetailPanel from "@/components/DetailPanel";
import ActionsPanel from "@/components/ActionsPanel";
import BackgroundFX from "@/components/BackgroundFX_v3";
import CyberMap from "@/components/CyberMap";
import PresenceCounter from "@/components/PresenceCounter";

interface DemoPrompt {
  emoji: string;
  title: string;
  subtitle: string;
  prompt: string;
  mode: MissionMode;
  role: string;
}

// Display name for the solo foil (the single-model race). Tracks the swarm's
// provider — Gemma for the hackathon. Override with NEXT_PUBLIC_FOIL_MODEL.
const FOIL_LABEL = process.env.NEXT_PUBLIC_FOIL_MODEL || "Gemma";

const DEMO_PROMPTS: DemoPrompt[] = [
  {
    emoji: "\u{1F454}",
    title: "Hire or pass on this engineer?",
    subtitle: "Verdict + red flags + comp range",
    prompt: `Should we hire this candidate? Give me a clear verdict, the red flags, and a comp range.

CANDIDATE: Alex Chen, Senior Backend Engineer applicant.
- 8 years experience, last 3 at a Series B fintech (lead engineer on payments)
- Earlier: 2 years at a small startup that shut down, 3 years at a FAANG
- GitHub: 2 popular OSS libs in Go (3k and 1.5k stars), last commit 14 months ago
- Asking $230k base + equity. Market for this role is $200-260k.
- Interview signal: aced the system design (designed a multi-region payment processor cleanly), bombed the live coding (couldn't finish a basic LRU cache in 45 min — said he was nervous)
- References: glowing from his Series B manager, lukewarm from FAANG manager ("solid but kept to himself, didn't volunteer for high-visibility work")
- He volunteered that he's interviewing at 3 other places and has one verbal offer at $250k base.`,
    mode: "recruiter",
    role: "recruiter",
  },
  {
    emoji: "\u{2696}\u{FE0F}",
    title: "Find every red flag in this contract",
    subtitle: "Liability traps, missing clauses, leverage",
    prompt: `Find every red flag, liability trap, and unfair clause in this contract excerpt. Tell me what to push back on and what's standard.

CONTRACT: Master Services Agreement excerpt.

3.2 INDEMNIFICATION. Service Provider shall defend, indemnify, and hold harmless Client and its affiliates, officers, directors, employees, and agents from and against ANY and all claims, damages, losses, costs (including reasonable attorneys' fees), and expenses arising from or related to (a) Service Provider's performance or non-performance under this Agreement, (b) any third-party claim regardless of cause, and (c) any breach of representations, warranties, or covenants herein.

5.1 PAYMENT. Fees due within sixty (60) days of invoice. Late payments accrue interest at 1.5% per month. Client may dispute any invoice in good faith and withhold the disputed amount; resolution may take up to 180 days.

7.3 TERMINATION FOR CONVENIENCE. Client may terminate this Agreement at any time for any reason or no reason with thirty (30) days notice, without liability for any uncompleted work or pre-paid fees.

9.1 IP ASSIGNMENT. All work product, deliverables, derivative works, and any pre-existing materials Service Provider incorporates into the deliverables shall be deemed work-for-hire and Service Provider hereby irrevocably assigns all rights, title, and interest therein to Client.

12.4 LIMITATION OF LIABILITY. Client's total liability shall not exceed fees paid in the preceding three (3) months. This limitation does not apply to Service Provider's indemnification obligations under Section 3.2.`,
    mode: "legal",
    role: "junior-lawyer",
  },
  {
    emoji: "\u{1F4C8}",
    title: "Pressure-test this product strategy",
    subtitle: "Market risk, competition, execution gaps",
    prompt: `Stress-test this product strategy. What's the biggest risk we're missing? Where will competitors crush us? What's the execution gap?

STRATEGY: Q1 2026 product plan for a B2B AI note-taking app called Recapio.

CURRENT STATE:
- 4,200 paying customers, $89/mo each, mostly mid-market sales teams
- Net retention 112%, gross retention 91%
- Top 3 competitors: Otter.ai ($2B valuation, broader market), Fireflies ($1B, similar ICP), Gong (enterprise, $7B, way more $)
- Our wedge: best-in-class Salesforce auto-sync, opinionated meeting summary format

Q1 PLAN:
1. Move upmarket — add SSO, audit logs, custom roles. Target $250k+ ACV enterprise deals.
2. Build a "deal intelligence" layer — auto-flag stalled deals, missing decision-makers, churn risk signals. Pitch this as "Gong-lite at 1/5 the price."
3. Layoff 30% of the customer success team to fund 8 new enterprise AEs.
4. Raise a $25M Series B in late Q1 on the strength of the new pipeline.

We have 14 months of runway at current burn. Founder/CEO is non-technical, raised once before.`,
    mode: "market",
    role: "consultant",
  },
];

export default function Home() {
  const [agents, setAgents] = useState<Map<string, AgentNode>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [scoutStatus, setScoutStatus] = useState<"idle" | "searching" | "found" | "none">("idle");
  const [scoutFindings, setScoutFindings] = useState<string | null>(null);
  const [scoutElapsedMs, setScoutElapsedMs] = useState(0);
  const scoutStartRef = useRef<number | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [humanMinutes, setHumanMinutes] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [lastMode, setLastMode] = useState<MissionMode>("generalist");
  const [lastRole, setLastRole] = useState<string>("none");
  const [lastFileCount, setLastFileCount] = useState(0);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [appMode, setAppMode] = useState<"dev" | "demo">("demo");
  const [actionsDismissed, setActionsDismissed] = useState(false);
  const [soloResult, setSoloResult] = useState<string | null>(null);
  const [soloElapsedMs, setSoloElapsedMs] = useState<number | null>(null);
  const [soloRunning, setSoloRunning] = useState(false);
  const [accessKey, setAccessKey] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState<"camera" | "type">("camera");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const k = params.get("key");
    if (k) setAccessKey(k);
    // Hackathon build: always max capacity — demo mode for everyone.
    setAppMode("demo");
  }, []);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("agentSpam.voice");
      if (saved === "on") setVoiceEnabled(true);
    } catch {
      // ignore
    }
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("agentSpam.voice", next ? "on" : "off");
      } catch {
        // ignore
      }
      if (!next && typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  }, []);

  function speakVerdict(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    // Pull JUST the "VERDICT: ..." line if the judge produced one;
    // fallback to the last sentence so we never read the whole essay.
    const verdictMatch = text.match(/\*\*\s*VERDICT\s*:?\s*\*\*\s*([^\n]+)/i);
    let line = verdictMatch?.[1] ?? "";
    if (!line) {
      const sentences = text
        .replace(/[*_#>`]+/g, "")
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      line = sentences[sentences.length - 1] ?? "";
    }
    const clean = line
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_#>]+/g, "")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /Daniel|Alex|Lee|Bruce|Fred/i.test(v.name) && v.lang.startsWith("en")) ||
      voices.find((v) => v.lang.startsWith("en-GB")) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (preferred) u.voice = preferred;
    u.rate = 0.92;
    u.pitch = 0.82;
    u.volume = 0.95;
    window.speechSynthesis.speak(u);
  }
  const [actions, setActions] = useState<ProposedAction[]>([]);

  // Clear any stale localStorage from when the toggle still wrote there.
  // Mode is now derived purely from URL key presence.
  useEffect(() => {
    try {
      localStorage.removeItem("agentSpam.appMode");
    } catch {
      // ignore
    }
  }, []);

  const agentsRef = useRef<Map<string, AgentNode>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const updateAgent = useCallback(
    (id: string, updates: Partial<AgentNode>) => {
      agentsRef.current = new Map(agentsRef.current);
      const existing = agentsRef.current.get(id);
      if (existing) {
        agentsRef.current.set(id, { ...existing, ...updates });
      }
      setAgents(new Map(agentsRef.current));
    },
    [],
  );

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId((prev) => (prev === id || !id ? null : id));
  }, []);

  const selectedAgent = useMemo(() => {
    if (!selectedAgentId) return null;
    return agents.get(selectedAgentId) ?? null;
  }, [agents, selectedAgentId]);

  const stats = useMemo(() => {
    let active = 0;
    let done = 0;
    let errors = 0;
    agents.forEach((a) => {
      if (a.status === "thinking" || a.status === "spawning") active++;
      else if (a.status === "complete") done++;
      else if (a.status === "error") errors++;
    });
    return { total: agents.size, active, done, errors };
  }, [agents]);

  useEffect(() => {
    setMemory(getMemory());
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedMs(Date.now() - startTimeRef.current);
      }
      if (scoutStartRef.current && scoutStatus === "searching") {
        setScoutElapsedMs(Date.now() - scoutStartRef.current);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning, scoutStatus]);

  // Safety net: when a run ends, mark any still-thinking agents as errored
  // so the Brain doesn't tick forever after a Vercel/stream timeout. Also
  // build a fallback summary from completed children if the Brain never
  // emitted final_result.
  useEffect(() => {
    if (isRunning) return;
    let changed = false;
    const newMap = new Map(agentsRef.current);
    newMap.forEach((agent, id) => {
      if (agent.status === "spawning" || agent.status === "thinking") {
        newMap.set(id, { ...agent, status: "error" });
        changed = true;
      }
    });
    if (changed) {
      agentsRef.current = newMap;
      setAgents(newMap);
    }
    if (!finalResult && newMap.size > 0) {
      const completed = Array.from(newMap.values()).filter(
        (a) => a.status === "complete" && a.result && a.depth > 0,
      );
      if (completed.length > 0) {
        const fallback =
          `*The Brain timed out before it could synthesize. Here's what its sub-agents came back with:*\n\n` +
          completed
            .slice(0, 8)
            .map((a) => `**${a.label}**\n${a.result?.slice(0, 400)}`)
            .join("\n\n---\n\n");
        setFinalResult(fallback);
        setShowResult(true);
      }
    }
  }, [isRunning, finalResult]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  const handleExport = useCallback(() => {
    const html = generateHtmlReport({
      prompt: lastPrompt,
      mode: lastMode,
      role: lastRole,
      fileCount: lastFileCount,
      totalCost,
      elapsedMs,
      humanMinutes,
      agents,
      finalResult,
    });

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `agentspam-run-${stamp}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [
    agents,
    finalResult,
    totalCost,
    elapsedMs,
    humanMinutes,
    lastPrompt,
    lastMode,
    lastRole,
    lastFileCount,
  ]);

  const handleSubmit = useCallback(
    async (
      prompt: string,
      files: FileAttachment[],
      mode: MissionMode,
      role: string,
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setIsRunning(true);
      setFinalResult(null);
      setActions([]);
      setActionsDismissed(false);
      setSoloResult(null);
      setSoloElapsedMs(null);
      setSoloRunning(true);

      // Fire the single-Claude foil in parallel with the main tree run.
      // Same prompt, no system prompt, no decomposition — just one shot for
      // the side-by-side comparison.
      (async () => {
        try {
          const r = await fetch("/api/single", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(accessKey ? { "x-demo-key": accessKey } : {}),
            },
            body: JSON.stringify({ prompt }),
            signal: ac.signal,
          });
          if (!r.ok) throw new Error("solo failed");
          const data = (await r.json()) as { text?: string; elapsedMs?: number };
          setSoloResult(data.text || "(empty response)");
          setSoloElapsedMs(data.elapsedMs ?? null);
        } catch {
          setSoloResult(null);
        } finally {
          setSoloRunning(false);
        }
      })();
      setSelectedAgentId(null);
      setScoutStatus("idle");
      setScoutFindings(null);
      setScoutElapsedMs(0);
      scoutStartRef.current = null;
      setTotalCost(0);
      setHumanMinutes(0);
      setElapsedMs(0);
      startTimeRef.current = Date.now();
      agentsRef.current = new Map();
      setAgents(new Map());

      setLastPrompt(prompt);
      setLastMode(mode);
      setLastRole(role);
      setLastFileCount(files.length);

      const memoryBlock = formatMemoryForBrain(getMemory());

      try {
        const res = await fetch("/api/spawn", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessKey ? { "x-demo-key": accessKey } : {}),
          },
          body: JSON.stringify({ prompt, files, mode, role, memory: memoryBlock, appMode }),
          signal: ac.signal,
        });

        if (!res.ok) {
          if (res.status === 403) throw new Error("Access denied — check your demo key in the URL.");
          if (res.status === 429) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? "Daily demo cap reached.");
          }
          throw new Error("API error");
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6);
            try {
              const event: AgentEvent = JSON.parse(json);

              switch (event.type) {
                case "scout_searching":
                  setScoutStatus("searching");
                  scoutStartRef.current = Date.now();
                  setScoutElapsedMs(0);
                  break;

                case "scout_complete":
                  setScoutStatus(event.findings ? "found" : "none");
                  setScoutFindings(event.findings);
                  if (scoutStartRef.current) {
                    setScoutElapsedMs(Date.now() - scoutStartRef.current);
                  }
                  break;

                case "cost_update":
                  setTotalCost(event.totalCost);
                  setHumanMinutes(event.humanMinutes);
                  break;

                case "agent_spawned":
                  agentsRef.current = new Map(agentsRef.current);
                  agentsRef.current.set(event.agent.id, event.agent);
                  setAgents(new Map(agentsRef.current));
                  spawnSound();
                  break;

                case "agent_thinking":
                  updateAgent(event.id, { status: "thinking" });
                  thinkingSound();
                  break;

                case "agent_complete":
                  updateAgent(event.id, {
                    status: "complete",
                    result: event.result,
                  });
                  completeSound();
                  if (
                    agentsRef.current.get(event.id)?.debateRole === "judge" &&
                    voiceEnabled
                  ) {
                    speakVerdict(event.result);
                  }
                  break;

                case "agent_named": {
                  const existing = agentsRef.current.get(event.id);
                  if (existing?.customSpecialist) {
                    updateAgent(event.id, {
                      customSpecialist: {
                        ...existing.customSpecialist,
                        name: event.name,
                      },
                    });
                  } else if (existing && existing.depth === 0) {
                    // Brain self-naming: append the picked name to the label.
                    updateAgent(event.id, {
                      label: `The Brain · ${event.name}`,
                    });
                  }
                  break;
                }

                case "memory_gist": {
                  const updated = addMemoryEntry({
                    prompt: event.prompt,
                    gist: event.gist,
                    mode: event.mode,
                  });
                  setMemory(updated);
                  break;
                }

                case "agent_escalated":
                  // All agents run on Gemma now, so this is a re-run for a
                  // better answer — not a model upgrade. Flag it as a second
                  // opinion instead of bumping the (cosmetic) tier.
                  updateAgent(event.id, { status: "thinking", secondOpinion: true });
                  thinkingSound();
                  break;

                case "agent_reviewing":
                  updateAgent(event.id, { status: "thinking" });
                  thinkingSound();
                  break;

                case "agent_error":
                  updateAgent(event.id, { status: "error" });
                  errorSound();
                  break;

                case "action_proposed":
                  setActions((prev) => [...prev, event.action]);
                  break;

                case "final_result":
                  setFinalResult(event.result);
                  setShowResult(true);
                  synthesisSound();
                  break;

                case "done":
                  setIsRunning(false);
                  break;
              }
            } catch {
              // skip malformed events
            }
          }
        }
      } catch (err) {
        console.error("Stream error:", err);
      }

      // Any agents still in spawning/thinking state when the stream ends
      // are orphaned (likely from a server timeout). Mark them as errored
      // so the UI doesn't show them as forever-ticking.
      agentsRef.current.forEach((agent, id) => {
        if (agent.status === "spawning" || agent.status === "thinking") {
          agentsRef.current.set(id, { ...agent, status: "error" });
        }
      });
      setAgents(new Map(agentsRef.current));

      setIsRunning(false);
    },
    [updateAgent, appMode, accessKey],
  );

  // Webcam "Stare": freeze a frame and unleash the full swarm on it. Reuses
  // the existing file pipeline — the frame is just an image FileAttachment,
  // so it flows through Extractor -> Brain -> swarm with no engine changes.
  const handleStare = useCallback(
    (frame: FileAttachment, question?: string) => {
      const q = question?.trim();
      const prompt = q
        ? `I'm showing you a live frame from my webcam. Look at the frame, then answer this specifically: "${q}". Ground your answer in what's actually visible — call out the objects, people, or text you're relying on. Have a real opinion.`
        : "I'm showing you a live frame from my webcam. Figure out what's in front of the camera and give me the sharpest, most useful read on it — key objects, any people, any text, and what's notable. React with real opinions, not a dry description.";
      handleSubmit(prompt, [frame], "generalist", "none");
    },
    [handleSubmit],
  );

  const renderCaptureToggle = () => (
    <div className="flex items-center gap-1 p-1 bg-white/5 border border-white/10 rounded-full">
      <button
        type="button"
        onClick={() => setCaptureMode("camera")}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
          captureMode === "camera"
            ? "bg-cyan-600 text-white"
            : "text-white/50 hover:text-white/80"
        }`}
      >
        {"\u{1F441}\u{FE0F}"} Camera
      </button>
      <button
        type="button"
        onClick={() => setCaptureMode("type")}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
          captureMode === "type"
            ? "bg-purple-600 text-white"
            : "text-white/50 hover:text-white/80"
        }`}
      >
        {"\u{1F4AC}"} Type
      </button>
    </div>
  );

  const hasAgents = agents.size > 0;

  const specialistResults = useMemo(() => {
    const out: Array<{
      label: string;
      emoji?: string;
      role?: string;
      result: string;
    }> = [];
    agents.forEach((agent) => {
      if (!agent.result) return;
      if (!agent.specialty && !agent.customSpecialist) return;
      out.push({
        label: agent.label,
        emoji: agent.customSpecialist?.emoji,
        role: agent.customSpecialist?.role,
        result: agent.result || "",
      });
    });
    return out;
  }, [agents]);

  return (
    <div className="relative flex flex-col h-screen bg-transparent text-white overflow-hidden">
      <CyberMap />
      <PresenceCounter />
      <BackgroundFX />
      <div className="relative z-10 flex flex-col flex-1 min-h-0">
      {/* Header */}
      <header className="flex-none px-6 py-3 border-b border-white/5">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-purple-400">agent</span>
              <span className="text-white">Spam</span>
            </h1>
            <span className="text-white/20 text-xs hidden sm:inline">
              one brain, infinite idiots
            </span>
            <button
              type="button"
              disabled
              title={
                accessKey === null
                  ? "Anonymous visitors are locked in dev mode"
                  : "Judges URL is locked in demo mode"
              }
              className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border opacity-60 cursor-not-allowed ${
                appMode === "demo"
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-white/5 border-white/15 text-white/60"
              }`}
            >
              {appMode === "demo" ? "● demo" : "○ dev"}
            </button>
            <button
              type="button"
              onClick={toggleVoice}
              title={`Judge voice ${voiceEnabled ? "ON — click to mute" : "OFF — click to enable"}`}
              className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border transition-all ${
                voiceEnabled
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25"
                  : "bg-white/5 border-white/15 text-white/40 hover:bg-white/10"
              }`}
            >
              {voiceEnabled ? "\u{1F50A} voice" : "\u{1F507} muted"}
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {(soloRunning || soloResult !== null) && (
              <div
                title={
                  soloRunning
                    ? `Single ${FOIL_LABEL} (no decomposition) is racing your tree…`
                    : `Single ${FOIL_LABEL} finished — view its answer alongside yours in the synthesis modal`
                }
                className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-mono ${
                  soloRunning
                    ? "border-zinc-500/40 bg-zinc-500/10 text-zinc-300"
                    : "border-zinc-400/40 bg-zinc-700/30 text-zinc-200"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${soloRunning ? "bg-zinc-300 animate-pulse" : "bg-zinc-200"}`} />
                <span>solo {FOIL_LABEL.toLowerCase()}</span>
                {soloElapsedMs !== null && (
                  <>
                    <span className="text-white/20">·</span>
                    <span>{(soloElapsedMs / 1000).toFixed(1)}s</span>
                  </>
                )}
              </div>
            )}
            {(isRunning || totalCost > 0) && (
              <div
                title="Estimated cost vs. equivalent human work time"
                className="flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[11px] font-mono"
              >
                <span>${totalCost.toFixed(4)}</span>
                <span className="text-white/20">·</span>
                <span>{(elapsedMs / 1000).toFixed(1)}s</span>
                {humanMinutes > 0 && (
                  <>
                    <span className="text-white/20">·</span>
                    <span className="text-emerald-200">
                      saves ~{humanMinutes}min
                    </span>
                  </>
                )}
              </div>
            )}
            {memory.length > 0 && (
              <button
                onClick={() => setShowMemory((v) => !v)}
                title={`${memory.length} past runs in local memory — the Brain can build on these`}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-[11px] hover:bg-indigo-500/20 transition-all"
              >
                <span>{"\u{1F4DA}"}</span>
                <span>{memory.length} {memory.length === 1 ? "memory" : "memories"}</span>
              </button>
            )}
            {scoutStatus !== "idle" && (
              <div
                title={scoutFindings || (scoutStatus === "none" ? "No live data needed" : "Scout searching...")}
                className={`
                  relative overflow-hidden flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] min-w-[200px]
                  ${scoutStatus === "searching" ? "border-cyan-500/40 bg-cyan-500/5 text-cyan-300" : ""}
                  ${scoutStatus === "found" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : ""}
                  ${scoutStatus === "none" ? "border-white/10 bg-white/5 text-white/40" : ""}
                `}
              >
                {scoutStatus === "searching" && (
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500/30 to-cyan-400/40 transition-all duration-100 ease-out"
                    style={{
                      width: `${Math.min(95, (1 - Math.exp(-scoutElapsedMs / 12000)) * 100)}%`,
                    }}
                  />
                )}
                {scoutStatus === "found" && (
                  <div className="absolute inset-0 bg-cyan-500/15" />
                )}
                <svg className="w-3 h-3 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <div className="flex items-center gap-1.5 relative z-10 flex-1 justify-between">
                  {scoutStatus === "searching" && (
                    <>
                      <span>Scout searching</span>
                      <span className="font-mono text-cyan-400/80">
                        {(scoutElapsedMs / 1000).toFixed(1)}s
                      </span>
                    </>
                  )}
                  {scoutStatus === "found" && (
                    <>
                      <span>Scout found data</span>
                      <span className="font-mono text-cyan-400/60">
                        {(scoutElapsedMs / 1000).toFixed(1)}s
                      </span>
                    </>
                  )}
                  {scoutStatus === "none" && <span>No live data needed</span>}
                </div>
              </div>
            )}
            {hasAgents && (
              <>
                <div className="flex items-center gap-3 text-white/30">
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1" />
                    Brain
                  </span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />
                    Mid
                  </span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />
                    Intern
                  </span>
                </div>
                <div className="h-4 w-px bg-white/10" />
                <div className="flex items-center gap-2 text-white/40 font-mono">
                  {stats.active > 0 && (
                    <span className="text-yellow-400">
                      {stats.active} active
                    </span>
                  )}
                  <span className="text-emerald-400/70">
                    {stats.done} done
                  </span>
                  {stats.errors > 0 && (
                    <span className="text-red-400/70">
                      {stats.errors} err
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main area */}
      <main className="flex-1 flex flex-col min-h-0 relative">
        {!hasAgents ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
            <div className="text-center">
              <div className="text-6xl mb-4">{"\u{1F9E0}"}</div>
              <h2 className="text-2xl font-bold mb-2">
                One brain. Infinite idiots.
              </h2>
              <p className="text-white/40 text-sm max-w-md">
                Give the Brain a task. It&apos;ll spawn progressively dumber
                agents that each do one thing. The tree of idiots collectively
                produces something brilliant.
              </p>
            </div>
            {renderCaptureToggle()}
            {captureMode === "camera" ? (
              <WebcamPanel onStare={handleStare} isRunning={isRunning} />
            ) : (
              <>
                <div className="w-full max-w-3xl flex flex-col items-center gap-3">
                  <div className="text-white/40 text-xs uppercase tracking-widest">
                    Or try one of these
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full">
                    {DEMO_PROMPTS.map((d) => (
                      <button
                        key={d.title}
                        onClick={() => handleSubmit(d.prompt, [], d.mode, d.role)}
                        disabled={isRunning}
                        className="group text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/40 rounded-xl p-4 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="text-2xl mb-2">{d.emoji}</div>
                        <div className="text-white font-medium text-sm mb-1">
                          {d.title}
                        </div>
                        <div className="text-white/40 text-xs line-clamp-2">
                          {d.subtitle}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <InputPanel onSubmit={handleSubmit} onStop={handleStop} isRunning={isRunning} />
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex-none p-4 pb-2 flex flex-col items-center gap-2">
              {renderCaptureToggle()}
              {captureMode === "camera" ? (
                <WebcamPanel onStare={handleStare} isRunning={isRunning} />
              ) : (
                <InputPanel onSubmit={handleSubmit} onStop={handleStop} isRunning={isRunning} />
              )}
            </div>

            <div className="flex-1 min-h-[300px] relative">
              <AgentTree
                agents={agents}
                onSelectAgent={handleSelectAgent}
                selectedAgentId={selectedAgentId}
              />

              {/* Hint overlay */}
              {!selectedAgentId && !isRunning && stats.done > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/20 text-xs bg-zinc-900/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5 pointer-events-none animate-fade-in">
                  click any agent to inspect
                </div>
              )}

              <DetailPanel
                agent={selectedAgent}
                onClose={() => setSelectedAgentId(null)}
              />
            </div>

            {finalResult && !showResult && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 animate-fade-in">
                <button
                  onClick={() => setShowResult(true)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-full shadow-lg shadow-purple-500/20 transition-all flex items-center gap-2"
                >
                  <div className="w-2 h-2 rounded-full bg-white/80" />
                  Show Final Synthesis
                </button>
              </div>
            )}
          </>
        )}
      </main>
      </div>

      {showResult && (
        <ResultPanel
          result={finalResult}
          agentCount={agents.size}
          onClose={() => setShowResult(false)}
          onExport={handleExport}
          totalCost={totalCost}
          elapsedMs={elapsedMs}
          humanMinutes={humanMinutes}
          role={lastRole}
          actions={actions}
          soloResult={soloResult}
          soloElapsedMs={soloElapsedMs}
          specialistResults={specialistResults}
        />
      )}

      {/* Floating actions card: visible whenever proposed actions exist but
          the result modal is closed (e.g. actions streamed in mid-run, or the
          user dismissed the modal but wants to fire actions later). */}
      {!showResult && actions.length > 0 && !actionsDismissed && (
        <div className="fixed bottom-4 right-4 z-[80] w-[360px] max-h-[70vh] overflow-y-auto bg-zinc-900/95 backdrop-blur-md border border-purple-500/30 rounded-2xl shadow-2xl shadow-purple-500/10 animate-fade-in">
          <button
            type="button"
            onClick={() => setActionsDismissed(true)}
            aria-label="Dismiss proposed actions"
            className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white/60 hover:text-white text-sm transition-all z-10"
          >
            ✕
          </button>
          <div className="p-3">
            <ActionsPanel actions={actions} />
          </div>
        </div>
      )}

      {showMemory && (
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-start justify-end animate-fade-in"
          onClick={() => setShowMemory(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[380px] h-full bg-zinc-900 border-l border-indigo-500/30 flex flex-col"
          >
            <div className="flex-none flex items-center gap-3 px-5 py-4 border-b border-white/10">
              <span className="text-lg">{"\u{1F4DA}"}</span>
              <div className="flex-1">
                <div className="text-indigo-300 text-sm font-bold uppercase tracking-wider">
                  Team Memory
                </div>
                <div className="text-white/40 text-[11px]">
                  {memory.length} past run{memory.length === 1 ? "" : "s"} the
                  Brain can build on
                </div>
              </div>
              <button
                onClick={() => setShowMemory(false)}
                className="text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-2 py-1 rounded"
              >
                ESC
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {memory.length === 0 && (
                <div className="text-white/30 text-sm italic">
                  No memories yet. Each run adds one when it completes.
                </div>
              )}
              {memory.map((m) => {
                const d = new Date(m.timestamp);
                return (
                  <div
                    key={m.id}
                    className="group bg-white/5 border border-white/10 hover:border-indigo-500/30 rounded-lg p-3 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-indigo-300 text-[10px] font-mono uppercase tracking-wider">
                        {d.toLocaleDateString()}{" "}
                        {d.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.mode && m.mode !== "generalist" && (
                          <span className="ml-2 text-white/30">
                            · {m.mode}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setMemory(removeMemoryEntry(m.id))}
                        className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-300 text-[11px] transition-all"
                      >
                        delete
                      </button>
                    </div>
                    <div className="text-white/50 text-[11px] mb-1 truncate">
                      {m.prompt}
                    </div>
                    <div className="text-white/90 text-sm leading-snug">
                      {m.gist}
                    </div>
                  </div>
                );
              })}
            </div>

            {memory.length > 0 && (
              <div className="flex-none p-4 border-t border-white/10">
                <button
                  onClick={() => {
                    if (confirm("Clear all team memory? This can't be undone.")) {
                      setMemory(clearMemory());
                    }
                  }}
                  className="w-full px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-medium rounded-lg transition-all"
                >
                  Clear all memory
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
