import { marked } from "marked";
import {
  AgentNode,
  MISSION_MODES,
  WORKER_ROLES,
} from "./types";

interface ReportData {
  prompt: string;
  mode: string;
  role: string;
  fileCount: number;
  totalCost: number;
  elapsedMs: number;
  humanMinutes: number;
  agents: Map<string, AgentNode>;
  finalResult: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(md: string): string {
  if (!md) return "";
  try {
    return marked.parse(md, { async: false }) as string;
  } catch {
    return `<pre>${escapeHtml(md)}</pre>`;
  }
}

function agentKindLabel(a: AgentNode): { tag: string; color: string } {
  if (a.customSpecialist) {
    return {
      tag: `${a.customSpecialist.emoji} ${a.customSpecialist.name ?? "Custom Specialist"}`,
      color: "fuchsia",
    };
  }
  if (a.specialty) {
    return { tag: a.specialty.toUpperCase(), color: "amber" };
  }
  return { tag: a.model.toUpperCase(), color: a.model };
}

export function generateHtmlReport(data: ReportData): string {
  const mode = MISSION_MODES.find((m) => m.id === data.mode);
  const role = WORKER_ROLES.find((r) => r.id === data.role);
  const showComparison =
    role && role.hourlyRate > 0 && data.humanMinutes > 0;

  const humanCost = showComparison
    ? (data.humanMinutes / 60) * role.hourlyRate
    : 0;
  const savingsPct = showComparison
    ? Math.max(0, (1 - data.totalCost / humanCost) * 100)
    : 0;
  const timesFaster =
    data.elapsedMs > 0
      ? Math.round(((data.humanMinutes * 60 * 1000) / data.elapsedMs) * 10) / 10
      : 0;

  const ordered = Array.from(data.agents.values()).sort((a, b) => {
    const aNum = parseInt(a.id.replace("agent-", ""), 10) || 0;
    const bNum = parseInt(b.id.replace("agent-", ""), 10) || 0;
    return aNum - bNum;
  });

  // Find debate topics and group their debaters/judge.
  const debateTopics = ordered.filter((a) => a.debateRole === "topic");
  const debateAgentIds = new Set<string>();
  const debateBlocks = debateTopics.map((topic) => {
    debateAgentIds.add(topic.id);
    const children = ordered.filter((a) => a.parentId === topic.id);
    children.forEach((c) => debateAgentIds.add(c.id));
    const rounds: { round: number; bull: AgentNode | null; bear: AgentNode | null }[] = [];
    const seenRounds = new Set<number>();
    children
      .filter((c) => c.debateRole === "bull" || c.debateRole === "bear")
      .forEach((c) => {
        const r = c.debateRound ?? 0;
        seenRounds.add(r);
      });
    Array.from(seenRounds)
      .sort((a, b) => a - b)
      .forEach((r) => {
        const bull = children.find((c) => c.debateRole === "bull" && c.debateRound === r) ?? null;
        const bear = children.find((c) => c.debateRole === "bear" && c.debateRound === r) ?? null;
        rounds.push({ round: r, bull, bear });
      });
    const judge = children.find((c) => c.debateRole === "judge") ?? null;
    return { topic, rounds, judge };
  });

  const debateHtml = debateBlocks
    .map((block, idx) => {
      const issueNum = String(idx + 1).padStart(2, "0");
      const roundsHtml = block.rounds
        .map(
          (r) => `
        <div class="zine-round">
          <div class="zine-round-label">ROUND ${r.round}</div>
          <div class="zine-vs-grid">
            <div class="zine-card zine-bull">
              <div class="zine-card-stamp">PRO</div>
              <div class="zine-card-name">${escapeHtml(r.bull?.customSpecialist?.emoji ?? "")} THE BULL</div>
              <div class="zine-card-body prose">${renderMarkdown(r.bull?.result ?? "(silence)")}</div>
            </div>
            <div class="zine-vs">VS</div>
            <div class="zine-card zine-bear">
              <div class="zine-card-stamp">CON</div>
              <div class="zine-card-name">${escapeHtml(r.bear?.customSpecialist?.emoji ?? "")} THE BEAR</div>
              <div class="zine-card-body prose">${renderMarkdown(r.bear?.result ?? "(silence)")}</div>
            </div>
          </div>
        </div>`,
        )
        .join("");
      const judgeHtml = block.judge
        ? `
        <div class="zine-verdict">
          <div class="zine-verdict-stamp">★ VERDICT ★</div>
          <div class="zine-verdict-name">THE JUDGE RULES</div>
          <div class="zine-verdict-body prose">${renderMarkdown(block.judge.result ?? "")}</div>
        </div>`
        : "";
      return `
      <section class="zine">
        <div class="zine-masthead">
          <div class="zine-mast-left">
            <div class="zine-mast-title">THE DECOMPOSED</div>
            <div class="zine-mast-sub">a debate zine // photocopied at 4am</div>
          </div>
          <div class="zine-mast-right">
            <div class="zine-issue">ISSUE #${issueNum}</div>
            <div class="zine-price">FREE / STEAL THIS</div>
          </div>
        </div>
        <div class="zine-topic">
          <div class="zine-topic-kicker">TONIGHT'S BEEF →</div>
          <div class="zine-topic-text">${escapeHtml(block.topic.label.replace(/^[^\s]+\s/, ""))}</div>
        </div>
        ${roundsHtml}
        ${judgeHtml}
        <div class="zine-footer">END / DESTROY ALL HIERARCHIES / agentSpam zine #${issueNum}</div>
      </section>`;
    })
    .join("\n");

  const treeHtml = ordered
    .map((a) => {
      const indent = "  ".repeat(a.depth);
      const k = agentKindLabel(a);
      return `${indent}<li class="tree-row tree-${k.color}"><span class="tree-tag">${escapeHtml(k.tag)}</span><span class="tree-label">${escapeHtml(a.label)}</span></li>`;
    })
    .join("\n");

  const agentsHtml = ordered
    .filter((a) => !debateAgentIds.has(a.id))
    .map((a) => {
      const k = agentKindLabel(a);
      return `
    <article class="agent agent-${k.color}">
      <header class="agent-header">
        <h3>${escapeHtml(a.label)}</h3>
        <span class="agent-tag tag-${k.color}">${escapeHtml(k.tag)}</span>
      </header>
      ${a.customSpecialist?.role ? `<p class="agent-role">${escapeHtml(a.customSpecialist.role)}</p>` : ""}
      <div class="agent-block">
        <div class="agent-label">Task</div>
        <div class="agent-task">${escapeHtml(a.task)}</div>
      </div>
      <div class="agent-block">
        <div class="agent-label">Output</div>
        <div class="agent-output prose">${renderMarkdown(a.result || "(no output)")}</div>
      </div>
    </article>`;
    })
    .join("\n");

  const synthesisHtml = renderMarkdown(data.finalResult ?? "(no final result)");

  const now = new Date();
  const dateStr = now.toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>agentSpam Run Report — ${escapeHtml(dateStr)}</title>
<style>
  :root {
    --ink: #1a1a1f;
    --muted: #6b7280;
    --line: #e5e7eb;
    --paper: #fafafa;
    --purple: #7c3aed;
    --purple-soft: #f3e8ff;
    --emerald: #059669;
    --emerald-soft: #d1fae5;
    --rose: #e11d48;
    --rose-soft: #ffe4e6;
    --fuchsia: #c026d3;
    --fuchsia-soft: #fae8ff;
    --amber: #d97706;
    --amber-soft: #fef3c7;
    --opus: #7c3aed;
    --sonnet: #2563eb;
    --haiku: #059669;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
  }

  .doc {
    max-width: 760px;
    margin: 0 auto;
    background: #ffffff;
    padding: 56px 64px 72px;
    min-height: 100vh;
  }

  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 24px;
    border-bottom: 2px solid var(--ink);
    margin-bottom: 40px;
  }
  .brand {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .brand .accent { color: var(--purple); }
  .meta {
    color: var(--muted);
    font-size: 12px;
  }

  h1 {
    font-size: 32px;
    line-height: 1.15;
    margin: 0 0 8px;
    letter-spacing: -0.02em;
    font-weight: 800;
  }
  h2 {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 56px 0 16px;
    font-weight: 700;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }
  h3 { font-size: 16px; margin: 0; font-weight: 700; }

  .lede {
    font-size: 16px;
    color: var(--ink);
    margin: 0 0 8px;
    font-weight: 500;
  }
  .task-box {
    background: var(--purple-soft);
    border-left: 3px solid var(--purple);
    padding: 14px 18px;
    margin: 18px 0;
    border-radius: 0 6px 6px 0;
    font-style: italic;
    color: #4c1d95;
  }

  .roi {
    background: var(--emerald-soft);
    border: 1px solid var(--emerald);
    border-radius: 10px;
    padding: 24px 28px;
    margin: 32px 0;
  }
  .roi h2 { margin-top: 0; color: var(--emerald); border: none; padding: 0; }
  .roi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin: 16px 0;
  }
  .roi-cell .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .roi-cell .value { font-size: 26px; font-weight: 800; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: -0.02em; }
  .roi-cell .ai .value { color: var(--emerald); }
  .roi-cell .human .value { color: var(--rose); text-decoration: line-through; text-decoration-color: rgba(225, 29, 72, 0.4); }
  .roi-cell .unit { font-size: 12px; color: var(--muted); margin-top: 2px; }

  .roi-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 16px;
    border-top: 1px solid rgba(5, 150, 105, 0.3);
    flex-wrap: wrap;
    gap: 12px;
  }
  .roi-stat .num { font-size: 28px; font-weight: 800; color: var(--emerald); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .roi-stat .num-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-left: 4px; }
  .roi-tagline { font-size: 12px; font-style: italic; color: var(--emerald); }

  .settings {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 8px 16px;
    font-size: 13px;
  }
  .settings dt { color: var(--muted); }
  .settings dd { margin: 0; font-weight: 500; }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  .metric {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px 16px;
  }
  .metric .label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
  .metric .value { font-size: 20px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 4px; }

  ul.tree {
    list-style: none;
    padding: 0;
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    background: #fafafa;
    border-radius: 8px;
    padding: 16px 20px;
    border: 1px solid var(--line);
    white-space: pre;
  }
  .tree-row { display: block; padding: 2px 0; }
  .tree-tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.05em;
    margin-right: 8px;
    color: #fff;
    text-transform: uppercase;
  }
  .tree-opus .tree-tag { background: var(--opus); }
  .tree-sonnet .tree-tag { background: var(--sonnet); }
  .tree-haiku .tree-tag { background: var(--haiku); }
  .tree-amber .tree-tag { background: var(--amber); }
  .tree-fuchsia .tree-tag { background: var(--fuchsia); }
  .tree-label { color: var(--ink); }

  .agent {
    border: 1px solid var(--line);
    border-left: 3px solid var(--haiku);
    border-radius: 6px;
    padding: 18px 22px;
    margin: 14px 0;
    page-break-inside: avoid;
  }
  .agent-opus { border-left-color: var(--opus); }
  .agent-sonnet { border-left-color: var(--sonnet); }
  .agent-haiku { border-left-color: var(--haiku); }
  .agent-amber { border-left-color: var(--amber); }
  .agent-fuchsia { border-left-color: var(--fuchsia); }

  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .agent-tag {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 4px;
    color: #fff;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .tag-opus { background: var(--opus); }
  .tag-sonnet { background: var(--sonnet); }
  .tag-haiku { background: var(--haiku); }
  .tag-amber { background: var(--amber); }
  .tag-fuchsia { background: var(--fuchsia); }

  .agent-role {
    font-size: 12.5px;
    color: var(--muted);
    font-style: italic;
    margin: 6px 0 12px;
    padding-left: 8px;
    border-left: 2px solid var(--line);
  }

  .agent-block { margin: 12px 0; }
  .agent-label {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 4px;
  }
  .agent-task {
    background: #fafafa;
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 13px;
    color: #374151;
    white-space: pre-wrap;
  }

  .prose { font-size: 13.5px; color: var(--ink); }
  .prose h1, .prose h2, .prose h3 {
    font-size: 14px;
    color: var(--ink);
    border: none;
    text-transform: none;
    letter-spacing: 0;
    margin: 14px 0 6px;
    padding: 0;
  }
  .prose p { margin: 6px 0; }
  .prose ul, .prose ol { margin: 6px 0; padding-left: 22px; }
  .prose li { margin: 2px 0; }
  .prose code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: #f3f4f6;
    padding: 1px 5px;
    border-radius: 3px;
  }
  .prose pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f3f4f6;
    padding: 10px 12px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 12px;
  }
  .prose blockquote {
    border-left: 3px solid var(--line);
    padding-left: 12px;
    color: var(--muted);
    margin: 8px 0;
  }
  .prose strong { color: var(--ink); }

  .synthesis {
    background: linear-gradient(180deg, #ffffff 0%, #fafafa 100%);
    border: 1px solid var(--purple);
    border-radius: 10px;
    padding: 28px 32px;
    margin: 16px 0;
  }
  .synthesis .prose { font-size: 14.5px; line-height: 1.65; }

  footer {
    margin-top: 56px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 11px;
    display: flex;
    justify-content: space-between;
  }
  footer .accent { color: var(--purple); font-weight: 600; }

  /* ─── PUNK ZINE DEBATE SECTION ─── */
  .zine {
    background: #fff;
    color: #000;
    border: 3px solid #000;
    padding: 0;
    margin: 24px 0 40px;
    font-family: "Helvetica Neue", "Arial Black", Impact, sans-serif;
    position: relative;
    box-shadow: 6px 6px 0 #000, 12px 12px 0 #e11d48;
  }
  .zine-masthead {
    background: #000;
    color: #fff;
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 3px solid #000;
  }
  .zine-mast-title {
    font-size: 30px;
    font-weight: 900;
    letter-spacing: -0.04em;
    text-transform: uppercase;
    line-height: 0.95;
    color: #fff;
  }
  .zine-mast-sub {
    font-size: 11px;
    color: #e11d48;
    font-style: italic;
    font-weight: 700;
    letter-spacing: 0.05em;
    margin-top: 4px;
  }
  .zine-mast-right { text-align: right; }
  .zine-issue {
    font-size: 13px;
    font-weight: 900;
    background: #e11d48;
    color: #fff;
    padding: 3px 8px;
    display: inline-block;
    transform: rotate(2deg);
  }
  .zine-price {
    font-size: 10px;
    color: #fff;
    margin-top: 6px;
    text-decoration: underline;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .zine-topic {
    padding: 18px 18px 6px;
    border-bottom: 2px dashed #000;
    background: repeating-linear-gradient(
      135deg,
      #fff 0 14px,
      #fff7ed 14px 16px
    );
  }
  .zine-topic-kicker {
    font-size: 11px;
    font-weight: 900;
    color: #e11d48;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .zine-topic-text {
    font-size: 22px;
    font-weight: 900;
    color: #000;
    margin-top: 4px;
    line-height: 1.15;
    text-transform: uppercase;
    letter-spacing: -0.02em;
  }
  .zine-round {
    padding: 22px 18px;
    border-bottom: 2px solid #000;
  }
  .zine-round-label {
    display: inline-block;
    font-size: 13px;
    font-weight: 900;
    background: #000;
    color: #fff;
    padding: 4px 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 14px;
    transform: rotate(-1deg);
  }
  .zine-vs-grid {
    display: grid;
    grid-template-columns: 1fr 50px 1fr;
    gap: 10px;
    align-items: stretch;
  }
  .zine-card {
    border: 2px solid #000;
    padding: 12px 14px;
    background: #fff;
    position: relative;
  }
  .zine-bull {
    background: #ffe4e6;
    transform: rotate(-0.4deg);
  }
  .zine-bear {
    background: #dbeafe;
    transform: rotate(0.4deg);
  }
  .zine-card-stamp {
    position: absolute;
    top: -10px;
    right: -10px;
    background: #000;
    color: #fff;
    font-size: 11px;
    font-weight: 900;
    padding: 3px 8px;
    transform: rotate(8deg);
    letter-spacing: 0.1em;
  }
  .zine-bull .zine-card-stamp { background: #e11d48; }
  .zine-bear .zine-card-stamp { background: #1d4ed8; }
  .zine-card-name {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
  }
  .zine-card-body {
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 13px;
    color: #1a1a1f;
    line-height: 1.5;
  }
  .zine-card-body p { margin: 6px 0; }
  .zine-card-body strong { background: #fef08a; padding: 0 2px; }
  .zine-vs {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    font-weight: 900;
    color: #e11d48;
    text-shadow: 2px 2px 0 #000;
    transform: rotate(-6deg);
    letter-spacing: -0.05em;
  }
  .zine-verdict {
    padding: 24px 18px;
    background: #fef9c3;
    border-top: 4px double #000;
  }
  .zine-verdict-stamp {
    display: inline-block;
    background: #000;
    color: #facc15;
    padding: 5px 12px;
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 0.15em;
    transform: rotate(-2deg);
    margin-bottom: 10px;
  }
  .zine-verdict-name {
    font-size: 22px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    border-bottom: 3px solid #000;
    padding-bottom: 4px;
    margin-bottom: 10px;
  }
  .zine-verdict-body {
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 14px;
    line-height: 1.55;
  }
  .zine-verdict-body p { margin: 8px 0; }
  .zine-footer {
    background: #000;
    color: #fff;
    padding: 8px 18px;
    font-size: 10px;
    text-align: center;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  @media print {
    body { background: #fff; }
    .doc { padding: 24px 32px; max-width: none; }
    .agent { page-break-inside: avoid; }
    .zine { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    .roi { page-break-inside: avoid; }
    .synthesis { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="doc">
  <div class="top">
    <div class="brand"><span class="accent">agent</span>Spam</div>
    <div class="meta">${escapeHtml(dateStr)}</div>
  </div>

  <h1>Run Report</h1>
  <p class="lede">A recursive AI agent decomposition log.</p>
  <div class="task-box">${escapeHtml(data.prompt || "(file-only run — no text prompt)")}</div>

  ${
    showComparison
      ? `<div class="roi">
    <h2>Headcount Replacement Math</h2>
    <div class="roi-grid">
      <div class="roi-cell ai">
        <div class="label">This run (AI)</div>
        <div class="value">$${data.totalCost.toFixed(4)}</div>
        <div class="unit">in ${(data.elapsedMs / 1000).toFixed(1)}s</div>
      </div>
      <div class="roi-cell human">
        <div class="label">1 ${escapeHtml(role.label)} @ $${role.hourlyRate}/hr</div>
        <div class="value">$${humanCost.toFixed(2)}</div>
        <div class="unit">in ~${data.humanMinutes} min</div>
      </div>
    </div>
    <div class="roi-bottom">
      <div class="roi-stat">
        <span class="num">${savingsPct.toFixed(2)}%</span>
        <span class="num-label">cheaper</span>
      </div>
      <div class="roi-stat">
        <span class="num">${timesFaster}x</span>
        <span class="num-label">faster</span>
      </div>
      <div class="roi-tagline">${escapeHtml(role.label.toLowerCase())} on notice</div>
    </div>
  </div>`
      : ""
  }

  <h2>Run Metrics</h2>
  <div class="metrics-grid">
    <div class="metric">
      <div class="label">API Cost</div>
      <div class="value">$${data.totalCost.toFixed(4)}</div>
    </div>
    <div class="metric">
      <div class="label">Wall-clock</div>
      <div class="value">${(data.elapsedMs / 1000).toFixed(1)}s</div>
    </div>
    <div class="metric">
      <div class="label">Human Equiv</div>
      <div class="value">~${data.humanMinutes}m</div>
    </div>
    <div class="metric">
      <div class="label">Agents</div>
      <div class="value">${data.agents.size}</div>
    </div>
  </div>

  <h2>Settings</h2>
  <dl class="settings">
    <dt>Mission Mode</dt>
    <dd>${escapeHtml(mode?.label ?? data.mode)}</dd>
    <dt>Compared To</dt>
    <dd>${escapeHtml(role?.label ?? data.role)}${role && role.hourlyRate > 0 ? ` ($${role.hourlyRate}/hr)` : ""}</dd>
    <dt>Files Attached</dt>
    <dd>${data.fileCount}</dd>
  </dl>

  <h2>Agent Tree</h2>
  <ul class="tree">
${treeHtml}
  </ul>

  <h2>Final Synthesis</h2>
  <div class="synthesis"><div class="prose">${synthesisHtml}</div></div>

  ${debateBlocks.length > 0 ? `<h2>The Debate Zine</h2>${debateHtml}` : ""}

  <h2>Agent Details</h2>
  ${agentsHtml}

  <footer>
    <span><span class="accent">agent</span>Spam · one brain, infinite idiots</span>
    <span>${escapeHtml(dateStr)}</span>
  </footer>
</div>
</body>
</html>`;
}
