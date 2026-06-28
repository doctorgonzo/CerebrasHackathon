export type ModelTier = "opus" | "sonnet" | "haiku";

export type Specialty = "researcher" | "calculator" | "critic";

export interface CustomSpecialist {
  name?: string; // agent picks this for itself
  emoji: string;
  role: string;
}

export type DebateRole = "topic" | "bull" | "bear" | "judge";

export interface AgentNode {
  id: string;
  parentId: string | null;
  depth: number;
  model: ModelTier;
  task: string;
  label: string;
  status: "spawning" | "thinking" | "complete" | "error";
  result?: string;
  specialty?: Specialty;
  customSpecialist?: CustomSpecialist;
  debateRole?: DebateRole;
  debateRound?: number;
  isEye?: boolean; // perception-layer vision agent (Multi-Eyes)
  secondOpinion?: boolean; // re-ran itself after a low-confidence first pass
}

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  researcher: "The Researcher",
  calculator: "The Calculator",
  critic: "The Critic",
};

export const SPECIALTY_EMOJI: Record<Specialty, string> = {
  researcher: "\u{1F50D}",
  calculator: "\u{1F522}",
  critic: "\u{1F928}",
};

export type ProposedAction =
  | {
      kind: "calendar";
      title: string;
      whenISO: string; // ISO datetime
      durationMins?: number;
      notes?: string;
    }
  | {
      kind: "email";
      to?: string;
      subject: string;
      body: string;
    };

export type AgentEvent =
  | { type: "scout_searching" }
  | { type: "scout_complete"; findings: string | null }
  | { type: "agent_spawned"; agent: AgentNode }
  | { type: "agent_thinking"; id: string }
  | { type: "agent_complete"; id: string; result: string }
  | { type: "agent_named"; id: string; name: string }
  | { type: "agent_escalated"; id: string; from: ModelTier; to: ModelTier; confidence: number }
  | { type: "agent_reviewing"; id: string }
  | { type: "action_proposed"; agentId: string; action: ProposedAction }
  | { type: "memory_gist"; prompt: string; gist: string; mode?: string }
  | { type: "agent_error"; id: string; error: string }
  | { type: "cost_update"; totalCost: number; humanMinutes: number }
  | { type: "final_result"; result: string }
  | { type: "done" };

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3 / 1e6, output: 15 / 1e6 },
  "claude-haiku-4-5-20251001": { input: 1 / 1e6, output: 5 / 1e6 },
  "gemma-4-31b": { input: 0.1 / 1e6, output: 0.1 / 1e6 },
};

export const WEB_SEARCH_COST = 0.01;

export interface FileAttachment {
  data: string;
  mediaType: string;
  name: string;
}

export interface SpawnRequest {
  prompt: string;
  file?: FileAttachment;
  files?: FileAttachment[]; // for batch (multi-file) runs
  mode?: MissionMode;
  role?: string; // worker role id for the headcount calculator
  memory?: string; // pre-formatted memory block for the Brain
  appMode?: "dev" | "demo"; // override server-default config for this run
}

export const MODEL_IDS: Record<ModelTier, string> = {
  opus: "claude-sonnet-4-6", // using sonnet as "brain" to save $$ — swap to opus for demo day
  sonnet: "claude-haiku-4-5-20251001",
  haiku: "claude-haiku-4-5-20251001",
};

export const MODEL_LABELS: Record<ModelTier, string> = {
  opus: "The Brain",
  sonnet: "Middle Mgmt",
  haiku: "The Intern",
};

export { default as config } from "./config";
import cfg from "./config";
export const MAX_DEPTH = cfg.maxDepth;
export const MAX_AGENTS = cfg.maxAgents;

export type MissionMode =
  | "generalist"
  | "market"
  | "engineering"
  | "legal"
  | "support"
  | "recruiter"
  | "puzzle"
  | "creative";

export interface MissionModeConfig {
  id: MissionMode;
  label: string;
  emoji: string;
  description: string;
  brainAddendum: string;
}

export interface WorkerRole {
  id: string;
  label: string;
  emoji: string;
  hourlyRate: number; // USD, fully-loaded labor cost
}

export const WORKER_ROLES: WorkerRole[] = [
  { id: "none", label: "No comparison", emoji: "\u{1F645}", hourlyRate: 0 },
  { id: "analyst", label: "Business Analyst", emoji: "\u{1F4CA}", hourlyRate: 85 },
  { id: "researcher", label: "Researcher", emoji: "\u{1F52C}", hourlyRate: 65 },
  { id: "recruiter", label: "Recruiter", emoji: "\u{1F454}", hourlyRate: 75 },
  { id: "engineer", label: "Senior Engineer", emoji: "\u{2699}\u{FE0F}", hourlyRate: 130 },
  { id: "consultant", label: "Mgmt Consultant", emoji: "\u{1F4BC}", hourlyRate: 400 },
  { id: "junior-lawyer", label: "Junior Lawyer", emoji: "\u{2696}\u{FE0F}", hourlyRate: 250 },
  { id: "senior-lawyer", label: "Senior Lawyer", emoji: "\u{1F468}\u200D\u{2696}\u{FE0F}", hourlyRate: 650 },
];

export const MISSION_MODES: MissionModeConfig[] = [
  {
    id: "generalist",
    label: "Generalist",
    emoji: "\u{1F9E0}",
    description: "No vertical bias",
    brainAddendum: "",
  },
  {
    id: "market",
    label: "Market Analyst",
    emoji: "\u{1F4C8}",
    description: "Financial / business analysis",
    brainAddendum:
      "DOMAIN: Market analysis. Frame subtasks around market dynamics, competitor positioning, financial impact, opportunity sizing. Strongly prefer a 'researcher' specialist for live pricing/news.",
  },
  {
    id: "engineering",
    label: "Engineering Lead",
    emoji: "\u{2699}\u{FE0F}",
    description: "Technical decomposition",
    brainAddendum:
      "DOMAIN: Engineering. Frame subtasks around architecture, implementation tradeoffs, scaling/risk concerns, dependencies, and migration steps. Strongly prefer a 'critic' to poke holes in the approach.",
  },
  {
    id: "legal",
    label: "Legal Reviewer",
    emoji: "\u{2696}\u{FE0F}",
    description: "Risk and compliance",
    brainAddendum:
      "DOMAIN: Legal/compliance review. Frame subtasks around regulatory exposure, contractual obligations, liability scenarios, and required disclosures. A 'critic' MUST be included to surface worst-case interpretations.",
  },
  {
    id: "support",
    label: "Support Director",
    emoji: "\u{1F3A7}",
    description: "Customer-facing comms",
    brainAddendum:
      "DOMAIN: Customer support leadership. Frame subtasks around customer sentiment, root-cause categories, response tone/messaging, escalation paths, and prevention. A 'critic' should challenge whether the response is empathetic enough.",
  },
  {
    id: "recruiter",
    label: "HR Recruiter",
    emoji: "\u{1F454}",
    description: "Candidate evaluation",
    brainAddendum:
      "DOMAIN: HR/recruiting. Frame subtasks around candidate skill match, experience depth, red flags, growth trajectory, and comparison-vs-bar. A 'critic' should call out bias, gaps, and unfounded assumptions in sibling evaluations.",
  },
  {
    id: "puzzle",
    label: "Puzzle Solver",
    emoji: "\u{1F9E9}",
    description: "Logic, riddles, lateral thinking",
    brainAddendum:
      "DOMAIN: Puzzles and logic. Frame subtasks around constraints, base cases, working backwards, lateral angles, and verification steps. Invent custom specialists who think differently — a pattern-spotter, a constraint-stripper, a contrarian who tries the inverse. A 'critic' MUST be included to test the solution against the original constraints.",
  },
  {
    id: "creative",
    label: "Creative Genius",
    emoji: "\u{1F3A8}",
    description: "Art, writing, photo critique",
    brainAddendum:
      "DOMAIN: Creative analysis. Frame subtasks around composition, emotional register, technical execution, cultural reference points, and what's missing. Invent custom specialists with strong aesthetic voices — a working artist, a brutal critic, a historian, a maximalist. NEVER hedge — creative opinions should be specific and stand behind a take.",
  },
];
