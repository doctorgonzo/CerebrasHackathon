import Anthropic from "@anthropic-ai/sdk";
import {
  AgentEvent,
  AgentNode,
  CustomSpecialist,
  FileAttachment,
  MISSION_MODES,
  MODEL_IDS,
  MODEL_LABELS,
  MODEL_PRICES,
  MissionMode,
  ModelTier,
  Specialty,
  WEB_SEARCH_COST,
} from "./types";
import { resolveConfig } from "./config";
import { createMessage, RawResult, PROVIDER } from "./model-provider";
import { SEARCH_ENABLED, webSearch, webSearchMany } from "./search-provider";

interface ClaudeResult {
  text: string;
  cost: number;
  outputTokens: number;
}

let agentCounter = 0;

function getTier(depth: number): ModelTier {
  if (depth === 0) return "opus";
  if (depth === 1) return "sonnet";
  return "haiku";
}

function makeId(): string {
  return `agent-${++agentCounter}`;
}

interface Subtask {
  label: string;
  description: string;
  specialty?: Specialty;
  customSpecialist?: CustomSpecialist;
}

interface DecomposeResult {
  type: "subtasks";
  subtasks: Subtask[];
}

interface DirectResult {
  type: "answer";
  answer: string;
}

type AgentResponse = DecomposeResult | DirectResult;

function getModeAddendum(mode?: MissionMode): string {
  if (!mode || mode === "generalist") return "";
  const cfg = MISSION_MODES.find((m) => m.id === mode);
  return cfg?.brainAddendum ? `\n\n${cfg.brainAddendum}` : "";
}

function buildRootPrompt(
  userPrompt: string,
  mode: MissionMode | undefined,
  cfg: { rootFanout: string },
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.opus,
    max_tokens: 1500,
    system: `You are THE BRAIN. You ONLY output JSON. You NEVER answer the user directly. Your job is splitting.

Split into ${cfg.rootFanout} subtasks. Witty 2-4 word labels. Each self-contained.

CRITICAL: If the user's message contains "[Live data from Scout..." or "[Document content...", that data is your sub-agents' ONLY source of facts (they have no web access). For each subtask, COPY the relevant facts (prices, names, numbers, quotes) directly into its description. Generic descriptions are useless — sub-agents need real data to produce real answers.

Three kinds of subtasks:

1. REGULAR (no specialty, no customSpecialist) — these fan out into deeper agents. Keep at least 2.

2. PREMADE SPECIALIST — set "specialty": "researcher" | "calculator" | "critic". At most 1 premade. Optional.

3. CUSTOM SPECIALIST — invent a new specialist on the spot. REQUIRED: 1 to 3 custom specialists per run. Set "customSpecialist" to an object:
   - emoji: ONE single emoji char that fits the role
   - role: a 1-2 sentence description of what this specialist excels at and how they think
   DO NOT include a name — the specialist will pick its own name based on the role.

Pick custom specialists that fit the user's task. Be creative — invent roles you wouldn't normally see. The custom specialists are the most exciting part of every run.${getModeAddendum(mode)}

OUTPUT FORMAT — nothing else:
{"subtasks":[
  {"label":"X","description":"Y"},
  {"label":"X","description":"Y","customSpecialist":{"emoji":"\u{1F50D}","role":"You are..."}},
  {"label":"X","description":"Y","specialty":"critic"}
]}`,
    messages: [
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${userPrompt}`,
      },
    ],
  };
}

function buildManagerPrompt(
  task: string,
  cfg: { managerFanout: string },
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 1100,
    system: `You are MIDDLE MGMT. JSON only. No prose. NEVER answer the task yourself — that is a failure. You ONLY split.

You MUST output ${cfg.managerFanout} self-contained subtasks with fun labels.

Optional specialty per subtask: "researcher" | "calculator" | "critic". Use sparingly.

JSON now:
{"subtasks":[{"label":"X","description":"Y","specialty":"researcher"}]}`,
    messages: [{ role: "user", content: `Task: ${task}` }],
  };
}

function buildWorkerPrompt(
  task: string,
  cfg: { workerFanout: string },
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 900,
    system: `You are a WORKER BEE. JSON only. You MUST split your task into ${cfg.workerFanout} tiny subtasks. NEVER answer directly — that is a failure.

Even if the task feels small or atomic, find ${cfg.workerFanout} angles to split it. Examples:
- "write a haiku about cats" → ["draft 3 candidates", "pick the best one", "polish wording"]
- "summarize section X" → ["extract main points", "identify key quotes", "compress to 2 sentences"]

The dumb interns below do the actual work. You only split.

JSON now:
{"subtasks":[{"label":"X","description":"Y"}]}`,
    messages: [{ role: "user", content: `Task: ${task}` }],
  };
}

function buildLeafPrompt(
  task: string,
  sharedContext?: string | null,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 300,
    system: `You are THE INTERN — one brain cell, one job. Do it in 1-3 sentences. Be direct and a little cheeky. End with [confidence: X/10].`,
    messages: [{ role: "user", content: buildCachedUserContent(task, sharedContext, "Your one job: ") }],
  };
}

function buildResearcherPrompt(
  task: string,
  sharedContext?: string | null,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 800,
    system: `You are THE RESEARCHER — a specialist agent with web search. You hunt down hard facts.

Use web search (max 4 searches) to find SPECIFIC data: numbers, names, dates, sources. When the question is time-sensitive, search using TODAY'S date — your training cutoff is stale. Then return your findings in 4-8 tight bullet points with sources cited inline. No fluff, no preamble. Just the facts and where they came from. End with [confidence: X/10].`,
    messages: [{ role: "user", content: buildCachedUserContent(task, sharedContext, `Today is ${new Date().toISOString().slice(0, 10)}.\n\nResearch task: `) }],
    tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 4 }],
  };
}

function buildCalculatorPrompt(
  task: string,
  sharedContext?: string | null,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 500,
    system: `You are THE CALCULATOR — a specialist agent for numbers. You do math, percentages, comparisons, and projections with precision.

Show your math step by step using markdown. Always state your assumptions. End with a single-line "Answer:" followed by the result. Be concise but exact — wrong numbers are unforgivable. End with [confidence: X/10].`,
    messages: [{ role: "user", content: buildCachedUserContent(task, sharedContext, "Calculation: ") }],
  };
}

// Build a user message content array that puts the (large, reused)
// sharedContext block first with cache_control, then the per-agent task.
// The cached block must be at least ~1024 tokens to actually hit the
// cache — that's why we bumped the sharedContext cap to 6000 chars.
function buildCachedUserContent(
  task: string,
  sharedContext: string | null | undefined,
  taskPrefix: string,
): Anthropic.MessageCreateParamsNonStreaming["messages"][0]["content"] {
  if (!sharedContext) {
    return taskPrefix + task;
  }
  return [
    {
      type: "text",
      text: `[Source material to draw on]:\n${sharedContext}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: taskPrefix + task,
    },
  ];
}

function buildCustomSpecialistPrompt(
  task: string,
  spec: CustomSpecialist,
  sharedContext?: string | null,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 600,
    system: `You are ${spec.name || "an unnamed specialist"} ${spec.emoji} — a custom specialist agent in agentSpam.

Your role: ${spec.role}

Stay in character. Be sharp, specific, concise. Output markdown. Lead with your strongest finding. No preamble.

OPTIONAL — if your finding would benefit from concrete next steps the user could TAKE, emit one or two action blocks. Format exactly:
[ACTION: calendar | title=Meeting title | when=2026-05-16T14:00:00Z | duration=30 | notes=Why this matters]
[ACTION: email | to=person@example.com | subject=Subject line | body=Email body text]
Only emit actions that genuinely fit. No fluff. ISO datetimes, no extra punctuation inside fields.

End with [confidence: X/10].`,
    messages: [{ role: "user", content: buildCachedUserContent(task, sharedContext, `Today is ${new Date().toISOString().slice(0, 10)}.\n\nYour task: `) }],
  };
}

function buildGistPrompt(
  userPrompt: string,
  synthesis: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 60,
    system:
      "You write a ONE-LINE summary of an AI run, under 140 chars. Capture: the topic, the verdict/result. Plain text, no quotes, no preamble. Past tense.",
    messages: [
      {
        role: "user",
        content: `Original task: ${userPrompt.slice(0, 400)}\n\nFinal output:\n${synthesis.slice(0, 1200)}\n\nWrite the one-line summary now:`,
      },
    ],
  };
}

function buildNamePickerPrompt(
  spec: CustomSpecialist,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 30,
    system:
      "Pick a vivid name for yourself in the format 'The X' (2-4 words). Match the role and have a little personality. Output ONLY the name. No quotes. No explanation.",
    messages: [
      {
        role: "user",
        content: `Your role: ${spec.role}\nYour emoji: ${spec.emoji}`,
      },
    ],
  };
}

function buildBrainNamerPrompt(
  taskPrompt: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 20,
    system:
      "You are THE BRAIN, naming yourself for this specific task. Pick a vivid 1-2 word epithet that fits the task's vibe. Examples for different tasks: 'The Marrow', 'Patient Zero', 'The Wretched Compiler', 'Old Smoke', 'Cathedral Mode', 'The Pulse'. Be creative, slightly menacing or poetic. Output ONLY the name. No 'The Brain'. No quotes. No explanation.",
    messages: [
      {
        role: "user",
        content: `Task: ${taskPrompt.slice(0, 500)}`,
      },
    ],
  };
}

function buildCriticPrompt(
  task: string,
  siblingResults: { label: string; result: string }[],
): Anthropic.MessageCreateParamsNonStreaming {
  const siblingText = siblingResults
    .map((r) => `### ${r.label}\n${r.result}`)
    .join("\n\n");

  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 600,
    system: `You are THE CRITIC — a specialist agent. You read your siblings' work and flag what's weak, unsupported, or wrong.

Be sharp. Be specific. Be brief.

Output a short markdown list of concerns or a confidence rating. If everything looks solid, say so in one line. If there are issues, name them concretely (e.g. "Sibling X claims Y but cites nothing"). No filler, no diplomacy.`,
    messages: [
      {
        role: "user",
        content: `Your review task: ${task}\n\nSibling outputs to review:\n\n${siblingText}`,
      },
    ],
  };
}

function buildSynthesisPrompt(
  originalTask: string,
  childResults: { label: string; result: string }[],
  tier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  const resultsText = childResults
    .map((r) => `[${r.label}]: ${r.result}`)
    .join("\n\n");

  return {
    model: MODEL_IDS[tier],
    max_tokens: tier === "opus" ? 1800 : 1500,
    system: `You are ${MODEL_LABELS[tier]} in agentSpam. Synthesize sub-agent results into ONE comprehensive final response.

Rules:
- Output markdown directly. No preamble, no "Here is..."
- Use section headers (##) to organize the response into logical sections
- Under each section, use bullet points with substantive detail (not one-liners)
- Weave findings together — don't just list what each sub-agent said
- If a Critic flagged issues, address them in their own section
- Aim for a thorough consultant-style report, not a TL;DR. Length is OK when it earns its place.`,
    messages: [
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nTask: ${originalTask}\n\nResults:\n${resultsText}\n\nSynthesize, briefly:`,
      },
    ],
  };
}

function buildScoutPrompt(
  userPrompt: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 1800,
    system: `You are THE SCOUT — a recon agent with web search. The sub-agents downstream have NO internet access, so YOU are their only source of live data. They will rely entirely on what you return.

DEFAULT BEHAVIOR: search. Err toward searching, not toward NONE. The cost of unnecessary searches is small; the cost of missing facts the sub-agents need is large.

Search (do 2-4 targeted queries) when ANY of these apply:
- Question involves real entities (companies, people, products, technologies, events)
- Question involves numbers, prices, valuations, statistics, comp ranges
- Question references current/recent things (news, trends, dates, "should we", "is X worth it")
- Question is a business decision, market analysis, hiring decision, or strategy call
- Question is about anything that might have changed since your training cutoff

Return NONE ONLY when the task is:
- Pure creative writing with no factual anchor (write me a haiku, name a band)
- Pure logic puzzles or math with no real-world entities
- Pure code questions about syntax or stdlib

If you're not sure, search. Searching is cheap. Missing facts is expensive for downstream agents.

When searching, pick queries that yield the most facts per search. Return a structured fact dump with concrete numbers, names, dates, and sources. Format as markdown bullets/sub-bullets, organized by topic. Include numbers and proper nouns. Use TODAY'S date for time-sensitive queries.

Do not explain. Do not preamble. Facts or NONE.`,
    messages: [
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${userPrompt}`,
      },
    ],
    tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 2 }],
  };
}

// --- Bring-your-own-search Scout (used when the model has no native web tool,
// i.e. Gemma-on-Cerebras). Step 1: turn the prompt into search queries.
function buildScoutQueryPrompt(
  userPrompt: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 200,
    system: `You decide what to web-search to gather live facts for downstream agents who have NO internet.

Given the user's task, output ONLY a JSON array of 1-3 short, high-yield search queries (strings). Use today's date for time-sensitive topics. Pick queries that surface concrete numbers, names, dates, and sources.

Output NONE (no array) only when the task needs no live facts: pure creative writing, pure logic/math puzzles, or pure code-syntax questions.

Respond with ONLY the JSON array or the word NONE. No prose.`,
    messages: [
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${userPrompt}`,
      },
    ],
  };
}

// Tolerant parse of the query-gen output: pull the first JSON array of strings,
// even if the model wrapped it in code fences or stray prose.
function parseQueries(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Step 3: synthesize raw search results into the Scout's fact-dump.
function buildScoutSynthPrompt(
  userPrompt: string,
  rawResults: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 1800,
    system: `You are THE SCOUT. Below are raw web search results. The sub-agents downstream have NO internet, so distill these into a tight, source-cited fact dump they can rely on.

Extract concrete numbers, names, dates, and proper nouns. Format as markdown bullets organized by topic, with sources cited inline. Do not invent facts not present in the results. Do not preamble. Facts only.`,
    messages: [
      {
        role: "user",
        content: `Task: ${userPrompt}\n\n=== WEB SEARCH RESULTS ===\n${rawResults}`,
      },
    ],
  };
}

function buildDocExtractorPrompt(
  userPrompt: string,
  file: FileAttachment,
): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.MessageCreateParamsNonStreaming["messages"][0]["content"] =
    [];

  if (file.mediaType.startsWith("image/")) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: file.mediaType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data: file.data,
      },
    });
  } else if (file.mediaType === "application/pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: file.data,
      },
    });
  }

  const userTask = userPrompt || `Analyze this ${file.name}`;
  content.push({
    type: "text",
    text: `User request: ${userTask}\n\nExtract the FULL key content from this document. Be thorough — include names, dates, numbers, quotes, section headings, specific items. Use markdown structure. Sub-agents downstream cannot see this file, so anything you don't extract is lost.`,
  });

  return {
    model: MODEL_IDS.haiku,
    max_tokens: 2500,
    system:
      "You are THE EXTRACTOR. Your only job is reading the attached document and dumping its key content as structured text. Use markdown with clear headings. Include actual content (names, numbers, quotes) — do NOT summarize generically. Do NOT add commentary. Just the facts as they appear.",
    messages: [{ role: "user", content }],
  };
}

// Multi-Eyes: instead of one Extractor describing a webcam frame, three vision
// specialists look at the SAME frame in parallel, each through a different lens.
// Their combined perception is what the Brain decomposes into the swarm.
interface EyeSpec {
  name: string;
  emoji: string;
  system: string;
  focus: string;
}

const EYES: EyeSpec[] = [
  {
    name: "The Object Eye",
    emoji: "\u{1F441}\u{FE0F}", // 👁️
    system:
      "You are THE OBJECT EYE — a vision specialist. You catalog what is physically present. No interpretation, no story — just a precise, concrete inventory.",
    focus:
      "Inventory everything physically visible in this frame: objects, people (count, posture, what they're doing and wearing), how things are arranged in space, colors, and materials. Be specific. Markdown bullets.",
  },
  {
    name: "The Word Eye",
    emoji: "\u{1F524}", // 🔤
    system:
      "You are THE WORD EYE — a vision specialist for text. You read and transcribe every legible character in the frame, verbatim.",
    focus:
      "Read ALL visible text exactly as written: labels, signs, screens, packaging, handwriting, logos, brand names, numbers, UI text. Transcribe verbatim in quotes. If there is no readable text, say 'No legible text.' Markdown bullets.",
  },
  {
    name: "The Scene Eye",
    emoji: "\u{1F310}", // 🌐
    system:
      "You are THE SCENE EYE — a vision specialist for context and gestalt. You read the whole situation, not the individual parts.",
    focus:
      "Read the overall scene: what's happening, the mood and lighting, the likely context or intent, and anything notable, surprising, or out of place. What story does this single frame tell? 3-6 tight sentences or bullets.",
  },
];

function buildEyePrompt(
  eye: EyeSpec,
  file: FileAttachment,
): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.MessageCreateParamsNonStreaming["messages"][0]["content"] =
    [];

  if (file.mediaType.startsWith("image/")) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: file.mediaType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data: file.data,
      },
    });
  }
  content.push({ type: "text", text: eye.focus });

  return {
    model: MODEL_IDS.haiku,
    max_tokens: 500,
    system: eye.system,
    messages: [{ role: "user", content }],
  };
}

function buildRootMultimodalPrompt(
  userPrompt: string,
  file: FileAttachment,
  mode: MissionMode | undefined,
  cfg: { rootFanout: string },
): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.MessageCreateParamsNonStreaming["messages"][0]["content"] =
    [];

  if (file.mediaType.startsWith("image/")) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: file.mediaType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data: file.data,
      },
    });
  } else if (file.mediaType === "application/pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: file.data,
      },
    });
  }

  const userTask = userPrompt || `Analyze this ${file.name}`;

  content.push({
    type: "text",
    text: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nDocument attached: ${file.name}\n\nUser request: ${userTask}\n\nIMPORTANT: Sub-agents CANNOT see this document. You MUST extract the key content from it and embed it directly in each subtask description so they have something to work with. Quote names, numbers, sections — make each subtask self-sufficient.`,
  });

  return {
    model: MODEL_IDS.opus,
    max_tokens: 1500,
    system: `You are THE BRAIN. You ONLY output JSON. Never answer directly.

You're analyzing a document. Read it carefully, then split the analysis into ${cfg.rootFanout} subtasks. Each subtask description MUST include the actual content from the document the sub-agent needs — names, quotes, numbers, full sections. Sub-agents have no access to the file.

Witty 2-4 word labels. Keep 2+ regular (no specialty/customSpecialist) so the tree fans out.

REQUIRED: 1-3 CUSTOM specialists per run. For each custom, set "customSpecialist" to {emoji, role} — DO NOT include a name (the specialist picks its own). Invent roles that fit the document/task (e.g. a resume surgeon \u{1FA7A} for a hiring doc, a risk auditor \u{1F6A8} for a contract).

Optional: at most 1 premade specialty ("researcher", "calculator", "critic").${getModeAddendum(mode)}

OUTPUT FORMAT — nothing else:
{"subtasks":[{"label":"X","description":"Y with embedded content","customSpecialist":{"emoji":"\u{1F50D}","role":"You are..."}}]}`,
    messages: [{ role: "user", content }],
  };
}

const JUNK_PATTERNS = [
  /^\[error:/i,
  /^\[stopped\]/i,
  /^\[max agents reached\]/i,
  /^i don'?t know/i,
  /^i'?m not sure/i,
  /^i cannot/i,
  /^i can'?t/i,
  /^sorry,? i/i,
  /^as an ai/i,
  /^i'?m unable/i,
  /^unfortunately/i,
];

function isJunkResult(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 10) return true;
  return JUNK_PATTERNS.some((p) => p.test(trimmed));
}

function buildRetryPrompt(
  task: string,
  previousAttempt: string,
  tier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  const upgradedTier = tier === "haiku" ? "sonnet" : tier;
  return {
    model: MODEL_IDS[upgradedTier],
    max_tokens: 400,
    system:
      "Your previous answer was inadequate. Give a concrete, specific, substantive response. No hedging, no refusals. If you lack info, reason from what you have.",
    messages: [
      { role: "user", content: task },
      { role: "assistant", content: previousAttempt.slice(0, 200) },
      {
        role: "user",
        content: "That was not useful. Try again — real answer this time.",
      },
    ],
  };
}

const CONFIDENCE_TAG = /\[confidence:\s*(\d+)\s*\/\s*10\]/i;

// Parse [ACTION: kind | key=value | key=value] blocks emitted by agents.
// Returns extracted actions + the text with blocks stripped.
const ACTION_BLOCK = /\[ACTION:\s*([^\]]+)\]/gi;
function parseActions(
  text: string,
): { clean: string; actions: import("./types").ProposedAction[] } {
  const actions: import("./types").ProposedAction[] = [];
  const stripped = text.replace(ACTION_BLOCK, (_, inner) => {
    const parts = String(inner)
      .split("|")
      .map((p: string) => p.trim());
    const kind = parts[0]?.toLowerCase();
    const fields: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf("=");
      if (eq < 0) continue;
      const k = parts[i].slice(0, eq).trim().toLowerCase();
      const v = parts[i].slice(eq + 1).trim();
      if (k) fields[k] = v;
    }
    if (kind === "calendar" && fields.title && fields.when) {
      actions.push({
        kind: "calendar",
        title: fields.title,
        whenISO: fields.when,
        durationMins: fields.duration ? parseInt(fields.duration, 10) || 60 : 60,
        notes: fields.notes,
      });
    } else if (kind === "email" && fields.subject && fields.body) {
      actions.push({
        kind: "email",
        to: fields.to,
        subject: fields.subject,
        body: fields.body,
      });
    }
    return ""; // strip block from displayed text
  });
  return { clean: stripped.trim(), actions };
}

function parseConfidence(text: string): { clean: string; confidence: number } {
  const match = text.match(CONFIDENCE_TAG);
  if (match) {
    return {
      clean: text.replace(match[0], "").trim(),
      confidence: Math.min(10, Math.max(1, parseInt(match[1], 10))),
    };
  }
  return { clean: text, confidence: 7 };
}

function escalateTier(tier: ModelTier): ModelTier {
  if (tier === "haiku") return "sonnet";
  return "opus";
}

function buildEscalationPrompt(
  task: string,
  previousAnswer: string,
  newTier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS[newTier],
    max_tokens: 600,
    system:
      "A first pass at this task came back low-confidence. You're giving it a second opinion — take a fresh, more careful look and do better. Give a concrete, thorough answer. End with [confidence: X/10].",
    messages: [
      { role: "user", content: task },
      { role: "assistant", content: previousAnswer.slice(0, 300) },
      {
        role: "user",
        content:
          "That first answer was low-confidence. Give it a second opinion — a better, more careful answer.",
      },
    ],
  };
}

function buildSelfReviewPrompt(
  task: string,
  answer: string,
  tier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS[tier],
    max_tokens: 500,
    system:
      "Review your previous answer for gaps, errors, or weak reasoning. If solid, return it with minimal tweaks. If flawed, return a corrected version. Output ONLY the revised answer — no meta-commentary.",
    messages: [
      { role: "user", content: task },
      { role: "assistant", content: answer },
      {
        role: "user",
        content: "Step back and review that. Anything wrong, missing, or unsupported? Return the final version.",
      },
    ],
  };
}

// Salvage a subtasks array from imperfect model output: handles a leading
// preamble before the JSON AND truncation (hit max_tokens mid-array) by
// brace-matching each complete {…} object inside "subtasks":[…] and discarding
// any incomplete trailing one. Smaller models like Gemma frequently produce
// exactly these two defects, and a strict JSON.parse would drop the whole
// decomposition — collapsing the agent into a leaf and starving the tree.
function salvageSubtasks(text: string): Subtask[] | null {
  const key = text.indexOf('"subtasks"');
  if (key === -1) return null;
  const arrStart = text.indexOf("[", key);
  if (arrStart === -1) return null;

  const out: Subtask[] = [];
  let i = arrStart + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") break;

    // Walk one object, respecting string literals/escapes, to its matching }.
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }
    if (depth !== 0) break; // truncated final object — stop here
    try {
      const obj = JSON.parse(text.slice(i, j));
      if (obj && typeof obj.label === "string" && typeof obj.description === "string") {
        out.push(obj as Subtask);
      }
    } catch {
      // skip an unparseable object, keep going
    }
    i = j;
  }
  return out.length ? out : null;
}

// Deterministic decomposition angles. When a mid-tree agent refuses to split
// (Gemma loves to just answer), we fan it out along these angles so the branch
// keeps growing toward maxDepth instead of dying as a leaf. This is the lever
// that turns a timid ~15-agent run into a real swarm: it makes recursion depend
// on the engine, not on the model's willingness to delegate.
const FORCE_SPLIT_ANGLES: { label: string; focus: string }[] = [
  { label: "Core Read", focus: "Nail the single most important thing here and why it matters." },
  { label: "Dig Deeper", focus: "Zoom in on the key detail and examine it closely." },
  { label: "Stress Test", focus: "Surface the risks, weaknesses, or edge cases." },
  { label: "Other Angle", focus: "Take a different or contrarian view than the obvious one." },
  { label: "Make It Concrete", focus: "Give a specific, concrete example or application." },
];

function forceSplit(task: string, count: number): Subtask[] {
  const n = Math.max(2, Math.min(count, FORCE_SPLIT_ANGLES.length));
  return FORCE_SPLIT_ANGLES.slice(0, n).map((a) => ({
    label: a.label,
    description: `${task}\n\nYour specific focus: ${a.focus}`,
  }));
}

function parseAgentResponse(text: string): AgentResponse {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.subtasks && Array.isArray(parsed.subtasks)) {
      return { type: "subtasks", subtasks: parsed.subtasks };
    }
    if (parsed.answer) {
      return { type: "answer", answer: parsed.answer };
    }
  } catch {
    // not clean JSON — fall through to tolerant salvage
  }

  // Tolerant pass: recover subtasks from truncated / preamble-wrapped output.
  const salvaged = salvageSubtasks(cleaned);
  if (salvaged) {
    return { type: "subtasks", subtasks: salvaged };
  }

  return { type: "answer", answer: text };
}

const AGENT_TIMEOUT_MS = 90000;

let inFlight = 0;
// Cerebras is fast enough to keep many agents in flight at once — this is what
// lets a 200-node swarm finish in seconds. If you start seeing 429s, dial back.
const MAX_CONCURRENT = 16;

function waitForSlot(signal?: AbortSignal): Promise<void> {
  if (inFlight < MAX_CONCURRENT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (signal?.aborted) { clearInterval(interval); reject(new Error("aborted")); }
      if (inFlight < MAX_CONCURRENT) { clearInterval(interval); resolve(); }
    }, 100);
  });
}

async function callClaude(
  params: Anthropic.MessageCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<ClaudeResult> {
  if (signal?.aborted) throw new Error("aborted");

  await waitForSlot(signal);
  inFlight++;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), AGENT_TIMEOUT_MS);

  const cleanup = () => { clearTimeout(timer); inFlight--; };
  const onUpstreamAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onUpstreamAbort);

  let result: RawResult | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) {
      cleanup();
      signal?.removeEventListener("abort", onUpstreamAbort);
      throw new Error("aborted");
    }
    try {
      result = await createMessage(params, timeoutController.signal);
      break;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 429 || status === 503) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      cleanup();
      signal?.removeEventListener("abort", onUpstreamAbort);
      if (timeoutController.signal.aborted && !signal?.aborted) {
        throw new Error("agent timed out (90s)");
      }
      throw err;
    }
  }
  if (!result) {
    cleanup();
    signal?.removeEventListener("abort", onUpstreamAbort);
    throw lastErr;
  }
  cleanup();
  signal?.removeEventListener("abort", onUpstreamAbort);

  const price = MODEL_PRICES[result.model] || { input: 0, output: 0 };
  const cost =
    result.inputTokens * price.input +
    result.outputTokens * price.output +
    result.searches * WEB_SEARCH_COST;

  return { text: result.text, cost, outputTokens: result.outputTokens };
}

export async function runAgentTree(
  prompt: string,
  files: FileAttachment[],
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
  mode?: MissionMode,
  _role?: string, // unused server-side; report uses it client-side
  memory?: string,
  appMode?: "dev" | "demo",
): Promise<void> {
  agentCounter = 0;
  const cfg = resolveConfig(appMode);

  let totalCost = 0;
  let totalOutputTokens = 0;

  function trackCost(result: ClaudeResult) {
    totalCost += result.cost;
    totalOutputTokens += result.outputTokens;
    // Rough heuristic: ~80 output tokens/min of equivalent human work.
    // Plus a baseline 1.5 min per agent for context-switching/thought.
    const humanMinutes = totalOutputTokens / 80 + agentCounter * 1.5;
    emit({
      type: "cost_update",
      totalCost,
      humanMinutes: Math.round(humanMinutes),
    });
  }

  async function call(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<string> {
    const result = await callClaude(params, signal);
    trackCost(result);
    return result.text;
  }

  // Race a primary agent call against a soft deadline. If the deadline fires,
  // we abort the primary and run a fast haiku fallback so the agent ALWAYS
  // produces output (instead of erroring out or hanging the tree).
  async function callOrFallback(
    primary: Anthropic.MessageCreateParamsNonStreaming,
    fallback: Anthropic.MessageCreateParamsNonStreaming,
    deadlineMs: number,
  ): Promise<string> {
    const innerAbort = new AbortController();
    const onUpstream = () => innerAbort.abort();
    signal?.addEventListener("abort", onUpstream);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const primaryPromise = (async () => {
        const result = await callClaude(primary, innerAbort.signal);
        trackCost(result);
        return result.text;
      })();
      // Swallow the primary's rejection if we end up aborting it on deadline,
      // so it doesn't surface as an unhandled rejection.
      primaryPromise.catch(() => {});

      const deadlinePromise = new Promise<"DEADLINE">((resolve) => {
        timer = setTimeout(() => {
          innerAbort.abort();
          resolve("DEADLINE");
        }, deadlineMs);
      });

      const winner = await Promise.race([
        primaryPromise.then((text) => ({ kind: "ok" as const, text })),
        deadlinePromise,
      ]);

      if (winner === "DEADLINE") {
        return await call(fallback);
      }
      return winner.text;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onUpstream);
    }
  }

  function buildFallbackParams(
    task: string,
    depth: number,
    specialty?: Specialty,
    customSpecialist?: CustomSpecialist,
  ): Anthropic.MessageCreateParamsNonStreaming {
    // Specialists / leaves / custom: produce a brief answer.
    if (specialty || customSpecialist || depth >= cfg.maxDepth) {
      const persona = customSpecialist
        ? `You are ${customSpecialist.name ?? "a specialist"} ${customSpecialist.emoji}. Role: ${customSpecialist.role}.`
        : specialty
          ? `You are a ${specialty} specialist.`
          : "You are an intern.";
      return {
        model: MODEL_IDS.haiku,
        max_tokens: 200,
        system: `${persona} Answer in 1-2 sentences. Plain text. Be direct — no preamble.`,
        messages: [{ role: "user", content: `Quick answer needed: ${task}` }],
      };
    }
    // Decomposers (Brain / Manager / Worker): produce a fast 2-3 subtask split.
    const splitCount = depth === 0 ? cfg.fallbackSplitRoot : cfg.fallbackSplitChild;
    const hasContext =
      task.includes("[Document content") ||
      task.includes("[Live data from Scout") ||
      task.includes("documents to compare]");
    const contextRule = hasContext
      ? " CRITICAL: the task contains document or scout content — COPY the relevant facts (names, numbers, quotes) directly into each subtask description. Sub-agents have no other source."
      : "";
    return {
      model: MODEL_IDS.haiku,
      max_tokens: hasContext ? 700 : 350,
      system: `Output JSON only. Split into ${splitCount} subtasks. No prose.${contextRule} Shape: {"subtasks":[{"label":"X","description":"Y"}]}`,
      messages: [{ role: "user", content: `Split this task: ${task}` }],
    };
  }

  // Detect bare URLs in a string. Conservative regex — http(s) only,
  // common URL chars, stops at whitespace or trailing punctuation.
  function extractUrls(text: string): string[] {
    const re = /https?:\/\/[^\s<>"`{}|\\^\[\]]+/gi;
    const matches = text.match(re) || [];
    // strip trailing punctuation that's likely sentence punctuation, not URL
    return matches
      .map((u) => u.replace(/[.,;:!?)\]]+$/, ""))
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .slice(0, 3); // cap at 3 URLs to keep cost down
  }

  // Fetch a URL and strip HTML to plain text. Returns null on failure
  // or non-HTML content. Conservative: 10s timeout, 1MB cap, common
  // browser user-agent so most sites don't 403.
  async function fetchUrlAsText(url: string): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/xhtml")) {
        return null;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 1_000_000) return null; // 1MB cap
      let html = new TextDecoder("utf-8", { fatal: false }).decode(buf);

      // Strip <script>, <style>, <noscript>, <svg>, <head> entirely.
      html = html.replace(/<(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, " ");
      // Strip nav/footer/header/aside since they're usually boilerplate.
      // Keep the rest — sites use too many different layout patterns for
      // a "focus on <article>" heuristic to work reliably.
      html = html.replace(
        /<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi,
        " ",
      );
      // Convert block tags to newlines, then strip all remaining tags
      html = html.replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n");
      html = html.replace(/<[^>]+>/g, "");
      // Decode common HTML entities
      html = html
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&[a-z]+;/gi, " ");
      // Collapse whitespace
      html = html.replace(/\s+/g, " ").trim();
      // Cap output length — long articles will get truncated
      if (html.length > 8000) html = html.slice(0, 8000) + "...";
      return html || null;
    } catch {
      return null;
    }
  }

  async function runScoutLocal(p: string): Promise<string | null> {
    // On Cerebras (Gemma) there's no native web_search tool, so run the
    // bring-your-own-search Scout: decide queries → Tavily → synthesize.
    if (PROVIDER === "cerebras") {
      if (!SEARCH_ENABLED) return null; // no key → no live data (don't fake it)
      return runScoutBYOSearch(p);
    }
    // Anthropic path: Claude's server-side web_search tool does it in one call.
    try {
      const text = await call(buildScoutPrompt(p));
      const trimmed = text.trim();
      if (!trimmed || trimmed.toUpperCase().includes("NONE")) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  // Gemma can't search itself: ask it for queries, run them through Tavily,
  // then have it distill the raw results into the Scout fact-dump.
  async function runScoutBYOSearch(p: string): Promise<string | null> {
    try {
      const raw = await call(buildScoutQueryPrompt(p));
      if (raw.trim().toUpperCase().includes("NONE")) return null;
      const queries = parseQueries(raw);
      if (queries.length === 0) return null;

      const results = await webSearchMany(queries.slice(0, 3), signal);
      if (!results) return null;

      const synth = await call(buildScoutSynthPrompt(p, results));
      const trimmed = synth.trim();
      return trimmed || null;
    } catch {
      return null;
    }
  }

  async function runExtractor(
    p: string,
    f: FileAttachment,
  ): Promise<string | null> {
    try {
      const text = await call(buildDocExtractorPrompt(p, f));
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  // Multi-Eyes perception layer. Spawns the three vision Eyes as visible nodes
  // under the (pre-spawned) Brain, runs them in parallel on the same frame, and
  // returns their combined perception (or null if every Eye failed).
  async function runEyes(
    parentId: string,
    file: FileAttachment,
  ): Promise<string | null> {
    const results = await Promise.all(
      EYES.map(async (eye) => {
        if (signal?.aborted) return { name: eye.name, text: "" };
        const id = makeId();
        const cs: CustomSpecialist = {
          name: eye.name,
          emoji: eye.emoji,
          role: eye.focus,
        };
        emit({
          type: "agent_spawned",
          agent: {
            id,
            parentId,
            depth: 1,
            model: "haiku",
            task: eye.focus,
            label: eye.name,
            status: "spawning",
            customSpecialist: cs,
            isEye: true,
          },
        });
        emit({ type: "agent_thinking", id });
        try {
          const text = await call(buildEyePrompt(eye, file));
          emit({ type: "agent_complete", id, result: text });
          return { name: eye.name, text: text.trim() };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "error";
          emit({ type: "agent_error", id, error: msg });
          return { name: eye.name, text: "" };
        }
      }),
    );
    const valid = results.filter((r) => r.text);
    if (valid.length === 0) return null;
    return valid.map((r) => `### ${r.name} saw:\n${r.text}`).join("\n\n");
  }

  let enrichedPrompt = prompt;
  let activeFile: FileAttachment | undefined = undefined;
  // Shared context passed to ALL answer-producing agents (leaves + specialists)
  // so that facts survive the decomposition chain. Capped for token cost.
  let sharedContext: string | null = null;
  // Webcam frames (a single image) go through the Multi-Eyes perception layer
  // instead of the single Extractor. brainPreId lets us pre-spawn the Brain so
  // the Eyes have a visible parent, then reuse that id for the real decomposition.
  const isSingleImage =
    files.length === 1 && files[0].mediaType.startsWith("image/");
  let brainPreId: string | undefined;

  if (isSingleImage) {
    // Pre-spawn the Brain so the three Eyes render as its first children.
    const brainId = makeId();
    brainPreId = brainId;
    emit({
      type: "agent_spawned",
      agent: {
        id: brainId,
        parentId: null,
        depth: 0,
        model: "opus",
        task: prompt || "Make sense of the scene",
        label: "The Brain",
        status: "spawning",
      },
    });
    emit({ type: "agent_thinking", id: brainId });
    const combined = await runEyes(brainId, files[0]);
    if (combined) {
      enrichedPrompt = `${prompt || "Make sense of what's in front of the camera."}\n\n[What the Eyes saw — this is your ONLY view of the scene; copy the concrete details into each subtask description so sub-agents can work with them]:\n${combined}`;
      sharedContext =
        combined.length > 6000 ? combined.slice(0, 6000) + "..." : combined;
    } else {
      // Every Eye failed — let the Brain look at the frame directly.
      activeFile = files[0];
    }
  } else if (files.length > 0) {
    // Two-pass file flow: Extractor reads each doc as text, Brain decomposes the text.
    // For multi-file batches, extract all in parallel and label each chunk.
    emit({ type: "scout_searching" });
    const extracts = await Promise.all(
      files.map(async (f) => ({ name: f.name, text: await runExtractor(prompt, f) })),
    );
    const valid = extracts.filter((e) => e.text);
    if (valid.length > 0) {
      const combined =
        valid.length === 1
          ? `[Document content from ${valid[0].name}]:\n${valid[0].text}`
          : `[${valid.length} documents to compare]:\n\n` +
            valid
              .map(
                (e, i) => `=== Document ${i + 1}: ${e.name} ===\n${e.text}`,
              )
              .join("\n\n");
      const taskHint =
        files.length > 1
          ? `Compare/analyze these ${files.length} documents: ${files.map((f) => f.name).join(", ")}`
          : `Analyze this ${files[0].name}`;
      enrichedPrompt = `${prompt || taskHint}\n\n${combined}`;
      sharedContext = combined.length > 6000 ? combined.slice(0, 6000) + "..." : combined;
      emit({ type: "scout_complete", findings: combined });
    } else if (files.length === 1) {
      // Extractor failed on a single file — fall back to multimodal Brain so
      // it can read the file directly.
      activeFile = files[0];
      emit({ type: "scout_complete", findings: null });
    } else {
      emit({ type: "scout_complete", findings: null });
    }
  } else if (prompt.trim() && extractUrls(prompt).length > 0) {
    // User pasted one or more URLs. Fetch them directly and skip Scout —
    // we know exactly where to look, no need to web-search.
    emit({ type: "scout_searching" });
    const urls = extractUrls(prompt);
    const fetched = await Promise.all(
      urls.map(async (u) => ({ url: u, text: await fetchUrlAsText(u) })),
    );
    const valid = fetched.filter((f) => f.text);
    if (valid.length > 0) {
      const combined =
        valid.length === 1
          ? `[Page content from ${valid[0].url}]:\n${valid[0].text}`
          : `[${valid.length} pages fetched]:\n\n` +
            valid
              .map((e, i) => `=== Page ${i + 1}: ${e.url} ===\n${e.text}`)
              .join("\n\n");
      enrichedPrompt = `${prompt}\n\n${combined}`;
      sharedContext = combined.length > 6000 ? combined.slice(0, 6000) + "..." : combined;
      emit({ type: "scout_complete", findings: combined });
    } else {
      // Fetch failed for all URLs — fall through to Scout as a fallback
      const findings = await runScoutLocal(prompt);
      if (findings) {
        const truncated = findings.length > 3000 ? findings.slice(0, 3000) + "..." : findings;
        enrichedPrompt = `${prompt}\n\n[Live data from Scout — embed relevant facts into each subtask description so sub-agents can work with real data]:\n${truncated}`;
        sharedContext = findings.length > 6000 ? findings.slice(0, 6000) + "..." : findings;
        emit({ type: "scout_complete", findings });
      } else {
        emit({ type: "scout_complete", findings: null });
      }
    }
  } else if (prompt.trim()) {
    emit({ type: "scout_searching" });
    const findings = await runScoutLocal(prompt);
    if (findings) {
      // Pass the FULL scout findings (capped generously) — the Brain needs the
      // real data to embed into sub-agent task descriptions. Sub-agents have
      // no web access so anything truncated here is lost downstream.
      const truncated = findings.length > 3000 ? findings.slice(0, 3000) + "..." : findings;
      enrichedPrompt = `${prompt}\n\n[Live data from Scout — embed relevant facts into each subtask description so sub-agents can work with real data]:\n${truncated}`;
      sharedContext = findings.length > 6000 ? findings.slice(0, 6000) + "..." : findings;
      emit({ type: "scout_complete", findings });
    } else {
      emit({ type: "scout_complete", findings: null });
    }
  }

  if (memory && memory.trim()) {
    enrichedPrompt = `${enrichedPrompt}\n\n[Prior runs you may build on — only use if directly relevant]:\n${memory}`;
  }

  async function runDebate(
    topic: { description: string; label: string },
    parentId: string,
    parentDepth: number,
  ): Promise<{ label: string; result: string }> {
    if (signal?.aborted) return { label: topic.label, result: "[stopped]" };

    const debateId = makeId();
    const debateLabel = `\u{1F94A} ${topic.label}`;
    emit({
      type: "agent_spawned",
      agent: {
        id: debateId,
        parentId,
        depth: parentDepth,
        model: "opus",
        task: topic.description,
        label: debateLabel,
        status: "spawning",
        debateRole: "topic",
      },
    });
    emit({ type: "agent_thinking", id: debateId });

    const bull: CustomSpecialist = {
      name: "The Bull",
      emoji: "\u{1F402}",
      role: "You argue FOR the proposal. Find every reason it could work. Address counterpoints head-on. Be specific and cite evidence.",
    };
    const bear: CustomSpecialist = {
      name: "The Bear",
      emoji: "\u{1F43B}",
      role: "You argue AGAINST the proposal. Find every reason it could fail. Attack weak assumptions and missing evidence. Be sharp, not contrarian.",
    };

    async function spawnDebater(
      spec: CustomSpecialist,
      round: number,
      opponentLast: string | null,
    ): Promise<string> {
      const id = makeId();
      const role: "bull" | "bear" = spec.name === "The Bull" ? "bull" : "bear";
      emit({
        type: "agent_spawned",
        agent: {
          id,
          parentId: debateId,
          depth: parentDepth + 1,
          model: "sonnet",
          task: topic.description,
          label: `${spec.name} R${round}`,
          status: "spawning",
          customSpecialist: spec,
          debateRole: role,
          debateRound: round,
        },
      });
      emit({ type: "agent_thinking", id });

      const system =
        round === 1
          ? `${spec.role}\n\nRound 1 of a debate. Give your strongest opening on the topic. Be specific. 3-5 sentences.`
          : `${spec.role}\n\nRound ${round} of a debate. Your opponent just said:\n\n"${opponentLast}"\n\nRebut sharply. Acknowledge any genuinely strong point briefly, then explain why your position still wins. 3-5 sentences.`;

      try {
        const text = await call({
          model: MODEL_IDS.sonnet,
          max_tokens: 400,
          system,
          messages: [{ role: "user", content: `Topic: ${topic.description}` }],
        });
        emit({ type: "agent_complete", id, result: text });
        return text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "error";
        emit({ type: "agent_error", id, error: msg });
        return `[error: ${msg}]`;
      }
    }

    let lastBull = "";
    let lastBear = "";
    for (let round = 1; round <= cfg.debateRounds; round++) {
      if (signal?.aborted) {
        emit({ type: "agent_complete", id: debateId, result: "[stopped mid-debate]" });
        return { label: debateLabel, result: "[stopped mid-debate]" };
      }
      const [b1, b2] = await Promise.all([
        spawnDebater(bull, round, round === 1 ? null : lastBear),
        spawnDebater(bear, round, round === 1 ? null : lastBull),
      ]);
      lastBull = b1;
      lastBear = b2;
    }

    const judgeId = makeId();
    const judgeSpec: CustomSpecialist = {
      name: "The Judge",
      emoji: "\u{2696}\u{FE0F}",
      role: "Impartial judge",
    };
    emit({
      type: "agent_spawned",
      agent: {
        id: judgeId,
        parentId: debateId,
        depth: parentDepth + 1,
        model: "opus",
        task: topic.description,
        label: "The Judge",
        status: "spawning",
        customSpecialist: judgeSpec,
        debateRole: "judge",
      },
    });
    emit({ type: "agent_thinking", id: judgeId });

    try {
      const verdict = await call({
        model: MODEL_IDS.opus,
        max_tokens: 600,
        system: `You are THE JUDGE — you watched a ${cfg.debateRounds}-round debate between The Bull (pro) and The Bear (con). Render a verdict in markdown. Acknowledge the strongest point from each side.

End with EXACTLY this format on its own final line:
**VERDICT:** <one-sentence ruling, 15 words max, declarative>

Be decisive.`,
        messages: [
          {
            role: "user",
            content: `Topic: ${topic.description}\n\nThe Bull's final: ${lastBull}\n\nThe Bear's final: ${lastBear}\n\nRender your verdict:`,
          },
        ],
      });
      emit({ type: "agent_complete", id: judgeId, result: verdict });
      emit({ type: "agent_complete", id: debateId, result: verdict });
      return { label: debateLabel, result: verdict };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      emit({ type: "agent_error", id: judgeId, error: msg });
      emit({ type: "agent_error", id: debateId, error: msg });
      return { label: debateLabel, result: `[debate error: ${msg}]` };
    }
  }

  async function spawnAgent(
    task: string,
    label: string,
    depth: number,
    parentId: string | null,
    specialty?: Specialty,
    criticContext?: { label: string; result: string }[],
    customSpecialist?: CustomSpecialist,
    existingId?: string,
  ): Promise<{ label: string; result: string }> {
    if (signal?.aborted) {
      return { label, result: "[stopped]" };
    }

    if (agentCounter >= cfg.maxAgents) {
      return { label, result: "[max agents reached]" };
    }

    const id = existingId ?? makeId();
    const tier = getTier(depth);

    const node: AgentNode = {
      id,
      parentId,
      depth,
      model: tier,
      task,
      label,
      status: "spawning",
      specialty,
      customSpecialist,
    };

    // When reusing a pre-spawned node (the Brain above the Eyes), it already
    // exists in the UI — don't emit a duplicate spawn.
    if (!existingId) {
      emit({ type: "agent_spawned", agent: node });
    }

    // The Brain picks an evocative one-off name for itself, fitted to the
    // task. Cheap haiku call, shows up as a label suffix.
    if (depth === 0 && !specialty && !customSpecialist) {
      try {
        const picked = (await call(buildBrainNamerPrompt(task)))
          .trim()
          .replace(/^["']|["']$/g, "")
          .replace(/^the\s+brain[,\s]*/i, "")
          .slice(0, 30);
        if (picked) {
          emit({ type: "agent_named", id, name: picked });
        }
      } catch {
        // ignore — brain stays as plain "The Brain", no big deal
      }
    }

    // Custom specialists pick their own name in a tiny haiku call before
    // the main task. Fast (~1s, cheap), and the name appears immediately on
    // the agent's badge.
    if (customSpecialist && !customSpecialist.name) {
      try {
        const picked = (await call(buildNamePickerPrompt(customSpecialist)))
          .trim()
          .replace(/^["']|["']$/g, "")
          .slice(0, 40);
        if (picked) {
          customSpecialist = { ...customSpecialist, name: picked };
          emit({ type: "agent_named", id, name: picked });
        }
      } catch {
        // ignore — agent stays unnamed, no big deal
      }
    }

    emit({ type: "agent_thinking", id });

    try {
      let params: Anthropic.MessageCreateParamsNonStreaming;

      // Answer-producing agents (leaves + specialists) get the shared doc/scout
      // context inlined via cache_control so facts survive even if upstream
      // decomposers dropped them, AND repeated input is cached across agents.
      const ctxForAnswer =
        sharedContext && (specialty || customSpecialist || depth >= cfg.maxDepth)
          ? sharedContext
          : null;

      if (customSpecialist) {
        params = buildCustomSpecialistPrompt(task, customSpecialist, ctxForAnswer);
      } else if (specialty === "researcher") {
        // On Cerebras the Researcher's native web_search tool is a no-op, so
        // pre-search with Tavily and inline the facts into its context.
        let researcherCtx = ctxForAnswer;
        if (PROVIDER === "cerebras" && SEARCH_ENABLED) {
          const live = await webSearch(task, signal);
          if (live) {
            researcherCtx = `${researcherCtx ? researcherCtx + "\n\n" : ""}[Live web results for this task — cite these, don't invent]:\n${live}`;
          }
        }
        params = buildResearcherPrompt(task, researcherCtx);
      } else if (specialty === "calculator") {
        params = buildCalculatorPrompt(task, ctxForAnswer);
      } else if (specialty === "critic") {
        params = buildCriticPrompt(task, criticContext || []);
      } else if (depth === 0 && activeFile) {
        params = buildRootMultimodalPrompt(task, activeFile, mode, cfg);
      } else if (depth === 0) {
        params = buildRootPrompt(task, mode, cfg);
      } else if (depth >= cfg.maxDepth) {
        params = buildLeafPrompt(task, ctxForAnswer);
      } else if (depth === 1) {
        params = buildManagerPrompt(task, cfg);
      } else {
        params = buildWorkerPrompt(task, cfg);
      }

      const fallbackParams = buildFallbackParams(
        task,
        depth,
        specialty,
        customSpecialist,
      );
      const hasHeavyContext =
        task.includes("[Document content") ||
        task.includes("documents to compare]") ||
        task.includes("[Live data from Scout");
      const deadline =
        depth === 0
          ? hasHeavyContext
            ? 75000
            : 45000
          : depth === 1
            ? 25000
            : 15000;
      let responseText = await callOrFallback(params, fallbackParams, deadline);
      let parsed = parseAgentResponse(responseText);

      // Specialists (premade or custom) always answer directly — they never decompose
      if (specialty || customSpecialist) {
        let answer = parsed.type === "answer" ? parsed.answer : responseText;
        if (isJunkResult(answer)) {
          try {
            answer = await call(buildRetryPrompt(task, answer, tier));
          } catch {
            // keep original answer if retry fails
          }
        }
        const { clean, confidence } = parseConfidence(answer);
        answer = clean;
        if (confidence <= 5) {
          const newTier = escalateTier(tier);
          emit({ type: "agent_escalated", id, from: tier, to: newTier, confidence });
          try {
            const escalated = await call(buildEscalationPrompt(task, answer, newTier));
            answer = parseConfidence(escalated).clean;
          } catch {
            // keep pre-escalation answer
          }
        }
        // Self-review disabled to save API costs — re-enable by uncommenting.
        // if (answer.length > 50 && !signal?.aborted) {
        //   emit({ type: "agent_reviewing", id });
        //   try {
        //     const reviewed = await call(buildSelfReviewPrompt(task, answer, tier));
        //     if (!isJunkResult(reviewed) && reviewed.length > 20) {
        //       answer = parseConfidence(reviewed).clean;
        //     }
        //   } catch {
        //     // keep original
        //   }
        // }
        const actionParse = parseActions(answer);
        answer = actionParse.clean || answer;
        for (const action of actionParse.actions) {
          emit({ type: "action_proposed", agentId: id, action });
        }
        emit({ type: "agent_complete", id, result: answer });
        return { label, result: answer };
      }

      // The Brain MUST decompose. If it returned an answer, retry once with a
      // more forceful prompt that uses the previous answer as context.
      if (depth === 0 && parsed.type !== "subtasks") {
        const retryParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: MODEL_IDS.opus,
          max_tokens: 900,
          system: `You are THE BRAIN. Your previous output was wrong — you answered directly when you MUST decompose. Try again. ONLY output JSON. Split into ${cfg.rootFanout} subtasks. Include 1-3 customSpecialists (invented roles with name/emoji/role).`,
          messages: [
            { role: "user", content: task },
            { role: "assistant", content: responseText.slice(0, 400) },
            {
              role: "user",
              content: `That was wrong. Output ONLY this JSON shape:\n{"subtasks":[{"label":"X","description":"Y","customSpecialist":{"name":"The X","emoji":"\u{1F50D}","role":"You are..."}}]}`,
            },
          ],
        };
        responseText = await call(retryParams);
        parsed = parseAgentResponse(responseText);
      }

      // Non-root, non-specialist agents at depth < cfg.maxDepth MUST also decompose
      // so the tree always has leaf interns at depth = cfg.maxDepth. If a Manager
      // or Worker answered directly, retry once.
      if (
        depth > 0 &&
        depth < cfg.maxDepth &&
        !specialty &&
        !customSpecialist &&
        parsed.type !== "subtasks"
      ) {
        const retryParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: MODEL_IDS[tier],
          max_tokens: 500,
          system: `Your previous output was wrong — you answered when you MUST decompose. Split this task into 2-3 atomic subtasks. JSON ONLY:`,
          messages: [
            { role: "user", content: `Task: ${task}` },
            { role: "assistant", content: responseText.slice(0, 300) },
            {
              role: "user",
              content: `Wrong. Output ONLY:\n{"subtasks":[{"label":"X","description":"Y"}]}`,
            },
          ],
        };
        responseText = await call(retryParams);
        parsed = parseAgentResponse(responseText);
      }

      // Last resort: if a mid-tree agent STILL refused to decompose, force a
      // deterministic split so the branch keeps growing instead of dying as a
      // leaf. This is what reliably scales the swarm on Gemma.
      if (
        depth > 0 &&
        depth < cfg.maxDepth &&
        !specialty &&
        !customSpecialist &&
        parsed.type !== "subtasks"
      ) {
        parsed = {
          type: "subtasks",
          subtasks: forceSplit(task, cfg.fallbackSplitChild),
        };
      }

      if (parsed.type === "subtasks" && depth < cfg.maxDepth) {
        if (signal?.aborted) {
          emit({ type: "agent_complete", id, result: "[stopped]" });
          return { label, result: "[stopped]" };
        }

        // Brain-level safety net: enforce shape of the tree.
        // - At least 2 regular subtasks (so the tree fans out).
        // - At most 3 custom specialists. If more, demote extras to regular.
        if (depth === 0) {
          // Brain isn't allowed to name customs — strip any names it tried to assign
          for (const sub of parsed.subtasks) {
            if (sub.customSpecialist?.name) {
              sub.customSpecialist = {
                emoji: sub.customSpecialist.emoji,
                role: sub.customSpecialist.role,
              };
            }
          }

          // Demote excess custom specialists beyond 3
          let customCount = parsed.subtasks.filter((s) => s.customSpecialist).length;
          if (customCount > 3) {
            for (let i = parsed.subtasks.length - 1; i >= 0 && customCount > 3; i--) {
              if (parsed.subtasks[i].customSpecialist) {
                parsed.subtasks[i].customSpecialist = undefined;
                customCount--;
              }
            }
          }
          // Ensure at least 2 regular subtasks — strip extras from premade specialists first
          let regularCount = parsed.subtasks.filter(
            (s) => !s.specialty && !s.customSpecialist,
          ).length;
          for (const sub of parsed.subtasks) {
            if (regularCount >= 2) break;
            if (sub.specialty && sub.specialty !== "critic") {
              sub.specialty = undefined;
              regularCount++;
            }
          }
        }

        const critics = parsed.subtasks.filter((s) => s.specialty === "critic");
        const nonCritics = parsed.subtasks.filter((s) => s.specialty !== "critic");

        // In demo mode, convert one regular subtask into a 3-round debate.
        // Picks the first regular (non-specialty, non-custom) child.
        const debateIdx =
          depth === 0 && cfg.enableDebate
            ? nonCritics.findIndex((s) => !s.specialty && !s.customSpecialist)
            : -1;
        const debateTopic = debateIdx >= 0 ? nonCritics[debateIdx] : null;

        const nonCriticResults = await Promise.all(
          nonCritics.map((sub, i) => {
            if (debateTopic && i === debateIdx) {
              return runDebate(
                { description: sub.description, label: sub.label },
                id,
                depth + 1,
              );
            }
            return spawnAgent(
              sub.description,
              sub.label,
              depth + 1,
              id,
              sub.specialty,
              undefined,
              sub.customSpecialist,
            );
          }),
        );

        if (signal?.aborted) {
          const partial = nonCriticResults.map((r) => r.result).join("\n\n");
          emit({ type: "agent_complete", id, result: partial || "[stopped]" });
          return { label, result: partial || "[stopped]" };
        }

        const criticResults = critics.length
          ? await Promise.all(
              critics.map((c) =>
                spawnAgent(c.description, c.label, depth + 1, id, "critic", nonCriticResults),
              ),
            )
          : [];

        const allChildResults = [...nonCriticResults, ...criticResults];

        if (signal?.aborted) {
          const partial = allChildResults.map((r) => r.result).join("\n\n");
          emit({ type: "agent_complete", id, result: partial || "[stopped]" });
          return { label, result: partial || "[stopped]" };
        }

        const childResults = allChildResults.filter(
          (r) => !isJunkResult(r.result),
        );
        if (childResults.length === 0) {
          emit({ type: "agent_complete", id, result: "[all sub-agents failed]" });
          return { label, result: "[all sub-agents failed]" };
        }

        const synthesisParams = buildSynthesisPrompt(task, childResults, tier);
        const synthesis = await call(synthesisParams);

        emit({ type: "agent_complete", id, result: synthesis });
        return { label, result: synthesis };
      } else {
        let answer =
          parsed.type === "answer" ? parsed.answer : responseText;
        if (isJunkResult(answer)) {
          try {
            answer = await call(buildRetryPrompt(task, answer, tier));
          } catch {
            // keep original answer if retry fails
          }
        }
        const { clean, confidence } = parseConfidence(answer);
        answer = clean;
        if (confidence <= 5) {
          const newTier = escalateTier(tier);
          emit({ type: "agent_escalated", id, from: tier, to: newTier, confidence });
          try {
            const escalated = await call(buildEscalationPrompt(task, answer, newTier));
            answer = parseConfidence(escalated).clean;
          } catch {
            // keep pre-escalation answer
          }
        }
        const actionParse = parseActions(answer);
        answer = actionParse.clean || answer;
        for (const action of actionParse.actions) {
          emit({ type: "action_proposed", agentId: id, action });
        }
        emit({ type: "agent_complete", id, result: answer });
        return { label, result: answer };
      }
    } catch (err) {
      if (signal?.aborted) {
        emit({ type: "agent_error", id, error: "stopped" });
        return { label, result: "[stopped]" };
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      emit({ type: "agent_error", id, error: msg });
      return { label, result: `[error: ${msg}]` };
    }
  }

  const rootResult = await spawnAgent(
    enrichedPrompt,
    "The Brain",
    0,
    null,
    undefined,
    undefined,
    undefined,
    brainPreId,
  );

  if (!signal?.aborted) {
    emit({ type: "final_result", result: rootResult.result });

    // Generate a one-line gist for the memory file. Cheap haiku call; fire
    // last so the user sees the synthesis pop first.
    try {
      const gist = (await call(buildGistPrompt(prompt, rootResult.result)))
        .trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 200);
      if (gist) {
        emit({ type: "memory_gist", prompt, gist, mode });
      }
    } catch {
      // ignore — memory is best-effort
    }
  }
  emit({ type: "done" });
}
