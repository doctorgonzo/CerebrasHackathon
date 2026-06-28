export interface MemoryEntry {
  id: string;
  timestamp: number;
  prompt: string;
  gist: string;
  mode?: string;
}

const KEY = "agentspam-memory";
const MAX_ENTRIES = 20;

export function getMemory(): MemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MemoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function addMemoryEntry(
  entry: Omit<MemoryEntry, "id" | "timestamp">,
): MemoryEntry[] {
  if (typeof window === "undefined") return [];
  const list = getMemory();
  const newEntry: MemoryEntry = {
    ...entry,
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  list.unshift(newEntry);
  const trimmed = list.slice(0, MAX_ENTRIES);
  localStorage.setItem(KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function removeMemoryEntry(id: string): MemoryEntry[] {
  if (typeof window === "undefined") return [];
  const list = getMemory().filter((e) => e.id !== id);
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export function clearMemory(): MemoryEntry[] {
  if (typeof window === "undefined") return [];
  localStorage.removeItem(KEY);
  return [];
}

export function formatMemoryForBrain(memory: MemoryEntry[]): string {
  if (!memory.length) return "";
  const lines = memory.map((m) => {
    const dt = new Date(m.timestamp);
    const ago = humanizeAgo(Date.now() - m.timestamp);
    return `- (${ago}) ${m.gist}`;
  });
  return lines.join("\n");
}

function humanizeAgo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
