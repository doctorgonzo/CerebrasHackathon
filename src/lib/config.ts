export type AppMode = "dev" | "demo";

export interface ModeConfig {
  maxDepth: number;
  maxAgents: number;
  rootFanout: string;
  managerFanout: string;
  workerFanout: string;
  fallbackSplitRoot: number;
  fallbackSplitChild: number;
  enableDebate: boolean;
  debateRounds: number;
}

export const MODES: Record<AppMode, ModeConfig> = {
  dev: {
    maxDepth: 3,
    maxAgents: 30,
    rootFanout: "4-5",
    managerFanout: "2-3",
    workerFanout: "2-3",
    fallbackSplitRoot: 3,
    fallbackSplitChild: 2,
    enableDebate: true,
    debateRounds: 3,
  },
  demo: {
    // Cranked up for Cerebras: Gemma is fast + cheap enough that a much bigger
    // swarm still resolves in seconds — and that density IS the wow. maxAgents
    // is the hard cap that keeps it from running away past the route's 60s.
    maxDepth: 6,
    maxAgents: 200,
    rootFanout: "6-8",
    managerFanout: "4-5",
    workerFanout: "3-4",
    fallbackSplitRoot: 5,
    fallbackSplitChild: 3,
    enableDebate: true,
    debateRounds: 3,
  },
};

// Hackathon build: always run at max capacity. Force demo unless someone
// explicitly opts into the cheap dev tree via NEXT_PUBLIC_AGENT_MODE=dev.
const envMode = process.env.NEXT_PUBLIC_AGENT_MODE;
export const DEFAULT_MODE: AppMode = envMode === "dev" ? "dev" : "demo";

const config = { ...MODES[DEFAULT_MODE], mode: DEFAULT_MODE };

export function resolveConfig(override?: AppMode | null) {
  const m: AppMode = override ?? DEFAULT_MODE;
  return { ...MODES[m], mode: m };
}

export default config;
