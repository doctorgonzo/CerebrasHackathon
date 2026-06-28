// In-memory daily budget cap, tracked per mode. Imperfect across multiple
// warm Vercel instances — if traffic spins up >1 region simultaneously,
// you can exceed the cap by a factor of the instance count. Good enough
// for a hackathon demo with low traffic. The real protection is at the
// Anthropic console (set a monthly hard cap there too).

type Mode = "dev" | "demo";

interface Bucket {
  date: string;
  spentUsd: number;
}

const buckets: Record<Mode, Bucket> = {
  dev: { date: "", spentUsd: 0 },
  demo: { date: "", spentUsd: 0 },
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureFresh(mode: Mode) {
  const t = todayStr();
  if (buckets[mode].date !== t) {
    buckets[mode] = { date: t, spentUsd: 0 };
  }
}

// Per-mode caps. Demo gets a bigger budget because each run costs more.
export const DEV_CAP_USD = parseFloat(process.env.DEV_CAP_USD ?? "1.00");
export const DEMO_CAP_USD = parseFloat(process.env.DAILY_CAP_USD ?? "1.50");

function capFor(mode: Mode): number {
  return mode === "demo" ? DEMO_CAP_USD : DEV_CAP_USD;
}

export function budgetStatus(mode: Mode = "demo"): {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
  mode: Mode;
} {
  ensureFresh(mode);
  const cap = capFor(mode);
  return {
    allowed: buckets[mode].spentUsd < cap,
    spentUsd: buckets[mode].spentUsd,
    capUsd: cap,
    mode,
  };
}

export function recordCost(usd: number, mode: Mode = "demo") {
  if (!Number.isFinite(usd) || usd <= 0) return;
  ensureFresh(mode);
  buckets[mode].spentUsd += usd;
}
