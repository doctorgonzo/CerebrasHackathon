// In-memory presence tracker — who's currently on the site, who's been on
// recently. Same caveats as budget.ts (lost on Vercel cold starts, doesn't
// sync across multiple instances). Good enough for a demo where the map
// needs to look populated. Pair with a seed fallback so it's never empty.

export interface PresencePing {
  sessionId: string;
  lat: number;
  lng: number;
  city?: string;
  country?: string;
  lastSeen: number; // epoch ms
}

const ACTIVE_WINDOW_MS = 60_000; // 1 min — "currently here"
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h — "been here recently"
const MAX_ENTRIES = 500; // cap so memory doesn't grow unbounded

const sessions = new Map<string, PresencePing>();

function prune() {
  const now = Date.now();
  for (const [id, p] of sessions.entries()) {
    if (now - p.lastSeen > RECENT_WINDOW_MS) sessions.delete(id);
  }
  // If somehow over the cap, drop oldest.
  if (sessions.size > MAX_ENTRIES) {
    const sorted = Array.from(sessions.entries()).sort(
      (a, b) => a[1].lastSeen - b[1].lastSeen,
    );
    for (let i = 0; i < sessions.size - MAX_ENTRIES; i++) {
      sessions.delete(sorted[i][0]);
    }
  }
}

export function pingPresence(p: Omit<PresencePing, "lastSeen">) {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
  if (p.lat === 0 && p.lng === 0) return; // sentinel / unknown
  sessions.set(p.sessionId, { ...p, lastSeen: Date.now() });
  prune();
}

// Seed dots — always-on background activity so the map doesn't look dead
// when no real users are online. Spread across populated regions. Marked
// with synthetic session IDs so they don't collide with real visitors.
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

export function getPresenceList(): {
  active: PresencePing[];
  recent: PresencePing[];
} {
  prune();
  const now = Date.now();
  const active: PresencePing[] = [];
  const recent: PresencePing[] = [];
  for (const p of sessions.values()) {
    const age = now - p.lastSeen;
    if (age <= ACTIVE_WINDOW_MS) active.push(p);
    else if (age <= RECENT_WINDOW_MS) recent.push(p);
  }
  // Seed dots get appended to recent if total population is thin so the
  // map always has something visible. Stagger their fake lastSeen so they
  // appear at varied ages.
  if (active.length + recent.length < 8) {
    for (let i = 0; i < SEED_DOTS.length; i++) {
      const dot = SEED_DOTS[i];
      const fakeAge = (i + 1) * 90 * 60 * 1000; // 1.5h apart
      recent.push({ ...dot, lastSeen: now - fakeAge });
    }
  }
  return { active, recent };
}
