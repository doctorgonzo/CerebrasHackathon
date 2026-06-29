// Presence tracker — who's currently on the site, who's been on recently.
//
// On Vercel the function runs as MANY short-lived instances, so an in-memory
// Map can't be the source of truth: your ping lands on one instance and your
// poll reads another (empty) one, which is why dots flicker and the count is
// wrong. When Upstash Redis is configured (UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN) we use it as ONE shared store every instance reads
// and writes — accurate across the whole fleet. Without those env vars we fall
// back to the in-memory map (fine for local dev; same old caveats in prod).

export interface PresencePing {
  sessionId: string;
  lat: number;
  lng: number;
  city?: string;
  country?: string;
  lastSeen: number; // epoch ms
}

const ACTIVE_WINDOW_MS = 60_000; // 1 min — "currently here" (client pings every 30s)
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h — "been here recently"
const MAX_ENTRIES = 500; // cap so the in-memory fallback doesn't grow unbounded

// --- Shared store (Upstash Redis REST) ------------------------------------
// Accept both naming schemes: Vercel's Upstash/KV marketplace integration
// injects KV_REST_API_URL / KV_REST_API_TOKEN, while a direct Upstash DB uses
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Either works — both are
// the same REST API. (Use the full-access token, not the read-only one; we
// write with ZADD/HSET.)
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

// Sorted set of sessionId -> lastSeen(score); hash of sessionId -> geo JSON.
const ZKEY = "presence:z";
const HKEY = "presence:h";

// Run a pipeline of Redis commands via the Upstash REST API. Returns the
// `result` of each command in order. Throws on transport/HTTP error.
async function redisPipeline(
  commands: (string | number)[][],
): Promise<unknown[]> {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string }[];
  return data.map((d) => d.result);
}

// --- In-memory fallback ----------------------------------------------------
const sessions = new Map<string, PresencePing>();

function pruneMem() {
  const now = Date.now();
  for (const [id, p] of sessions.entries()) {
    if (now - p.lastSeen > RECENT_WINDOW_MS) sessions.delete(id);
  }
  if (sessions.size > MAX_ENTRIES) {
    const sorted = Array.from(sessions.entries()).sort(
      (a, b) => a[1].lastSeen - b[1].lastSeen,
    );
    for (let i = 0; i < sessions.size - MAX_ENTRIES; i++) {
      sessions.delete(sorted[i][0]);
    }
  }
}

// --- Public API ------------------------------------------------------------
// Record a heartbeat. Never throws — presence must not break a real request.
export async function pingPresence(
  p: Omit<PresencePing, "lastSeen">,
): Promise<void> {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
  if (p.lat === 0 && p.lng === 0) return; // sentinel / unknown

  const now = Date.now();

  if (USE_REDIS) {
    try {
      const geo = JSON.stringify({
        lat: p.lat,
        lng: p.lng,
        city: p.city,
        country: p.country,
      });
      await redisPipeline([
        ["ZADD", ZKEY, now, p.sessionId],
        ["HSET", HKEY, p.sessionId, geo],
        // Trim anyone past the recent window so the set stays small.
        ["ZREMRANGEBYSCORE", ZKEY, "-inf", now - RECENT_WINDOW_MS],
      ]);
    } catch {
      // Swallow — a Redis hiccup must never break the page.
    }
    return;
  }

  sessions.set(p.sessionId, { ...p, lastSeen: now });
  pruneMem();
}

// Seed dots — always-on background activity so the map never looks dead.
// Synthetic session IDs so they don't collide with real visitors.
const SEED_DOTS: Omit<PresencePing, "lastSeen">[] = [
  { sessionId: "seed:nyc", lat: 40.7128, lng: -74.006, city: "New York", country: "US" },
  { sessionId: "seed:sf", lat: 37.7749, lng: -122.4194, city: "San Francisco", country: "US" },
  { sessionId: "seed:austin", lat: 30.2672, lng: -97.7431, city: "Austin", country: "US" },
  { sessionId: "seed:london", lat: 51.5074, lng: -0.1278, city: "London", country: "GB" },
  { sessionId: "seed:berlin", lat: 52.52, lng: 13.405, city: "Berlin", country: "DE" },
  { sessionId: "seed:lisbon", lat: 38.7223, lng: -9.1393, city: "Lisbon", country: "PT" },
  { sessionId: "seed:tokyo", lat: 35.6762, lng: 139.6503, city: "Tokyo", country: "JP" },
  { sessionId: "seed:singapore", lat: 1.3521, lng: 103.8198, city: "Singapore", country: "SG" },
  { sessionId: "seed:sydney", lat: -33.8688, lng: 151.2093, city: "Sydney", country: "AU" },
  { sessionId: "seed:bangalore", lat: 12.9716, lng: 77.5946, city: "Bangalore", country: "IN" },
  { sessionId: "seed:saopaulo", lat: -23.5505, lng: -46.6333, city: "São Paulo", country: "BR" },
  { sessionId: "seed:toronto", lat: 43.6532, lng: -79.3832, city: "Toronto", country: "CA" },
];

// Append seed dots to `recent` when the real population is thin, so the map
// always has something visible. Staggered fake ages so they vary.
function applySeed(active: PresencePing[], recent: PresencePing[], now: number) {
  if (active.length + recent.length >= 8) return;
  for (let i = 0; i < SEED_DOTS.length; i++) {
    const fakeAge = (i + 1) * 90 * 60 * 1000; // 1.5h apart
    recent.push({ ...SEED_DOTS[i], lastSeen: now - fakeAge });
  }
}

export async function getPresenceList(): Promise<{
  active: PresencePing[];
  recent: PresencePing[];
}> {
  const now = Date.now();
  const active: PresencePing[] = [];
  const recent: PresencePing[] = [];

  if (USE_REDIS) {
    try {
      const [zres] = await redisPipeline([
        ["ZRANGEBYSCORE", ZKEY, now - RECENT_WINDOW_MS, "+inf", "WITHSCORES"],
      ]);
      // WITHSCORES returns a flat [member, score, member, score, ...] array.
      const flat = (zres as string[]) ?? [];
      const ids: string[] = [];
      const scores: number[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        ids.push(flat[i]);
        scores.push(Number(flat[i + 1]));
      }
      if (ids.length > 0) {
        const [geos] = await redisPipeline([["HMGET", HKEY, ...ids]]);
        const arr = (geos as (string | null)[]) ?? [];
        for (let i = 0; i < ids.length; i++) {
          const raw = arr[i];
          if (!raw) continue;
          let g: { lat: number; lng: number; city?: string; country?: string };
          try {
            g = JSON.parse(raw);
          } catch {
            continue;
          }
          const ping: PresencePing = {
            sessionId: ids[i],
            lat: g.lat,
            lng: g.lng,
            city: g.city,
            country: g.country,
            lastSeen: scores[i],
          };
          if (now - ping.lastSeen <= ACTIVE_WINDOW_MS) active.push(ping);
          else recent.push(ping);
        }
      }
    } catch {
      // Redis unavailable — fall through to seed dots only.
    }
    applySeed(active, recent, now);
    return { active, recent };
  }

  pruneMem();
  for (const p of sessions.values()) {
    const age = now - p.lastSeen;
    if (age <= ACTIVE_WINDOW_MS) active.push(p);
    else if (age <= RECENT_WINDOW_MS) recent.push(p);
  }
  applySeed(active, recent, now);
  return { active, recent };
}
