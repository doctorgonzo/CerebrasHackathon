import { pingPresence, getPresenceList } from "@/lib/presence";

// Edge-fast — no Anthropic calls here, just reading geo headers and
// touching the in-memory presence map.
export const runtime = "nodejs"; // keep nodejs so the in-memory map persists across requests in the same instance

// POST /api/presence — heartbeat ping. Body: { sessionId }
// Geo comes from Vercel's x-vercel-ip-* headers (free, no key needed).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Need sessionId" }), {
        status: 400,
      });
    }

    const lat = parseFloat(req.headers.get("x-vercel-ip-latitude") ?? "");
    const lng = parseFloat(req.headers.get("x-vercel-ip-longitude") ?? "");
    const city = req.headers.get("x-vercel-ip-city") ?? undefined;
    const country = req.headers.get("x-vercel-ip-country") ?? undefined;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      // No geo available (local dev, geo not resolved) — silently skip.
      return new Response(JSON.stringify({ ok: true, geo: false }), {
        status: 200,
      });
    }

    pingPresence({
      sessionId,
      lat,
      lng,
      city: city ? decodeURIComponent(city) : undefined,
      country: country || undefined,
    });

    return new Response(JSON.stringify({ ok: true, geo: true }), {
      status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "presence ping failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

// GET /api/presence — return the current active + recent lists.
// Strips sessionId from the response (privacy / no point exposing).
export async function GET() {
  const { active, recent } = getPresenceList();
  const sanitize = (p: { lat: number; lng: number; city?: string; country?: string; lastSeen: number }) => ({
    lat: p.lat,
    lng: p.lng,
    city: p.city,
    country: p.country,
    lastSeen: p.lastSeen,
  });
  return new Response(
    JSON.stringify({
      active: active.map(sanitize),
      recent: recent.map(sanitize),
      now: Date.now(),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}
