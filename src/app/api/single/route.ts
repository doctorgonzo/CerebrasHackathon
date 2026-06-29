import crypto from "node:crypto";
import { budgetStatus, recordCost } from "@/lib/budget";
import { pingPresence } from "@/lib/presence";
import { createMessage } from "@/lib/model-provider";
import { MODEL_PRICES } from "@/lib/types";

export const maxDuration = 60;

// Clean single-model foil for the side-by-side comparison.
// NO system prompt, NO engineering. Routed through the SAME provider as the
// swarm (createMessage), so when MODEL_PROVIDER=cerebras this is Gemma-vs-Gemma
// — an honest apples-to-apples measure of "one model alone" against the tree.
// Raw user prompt straight to the model. The whole point is to give the user's
// tree something fair to be measured against.
export async function POST(req: Request) {
  // Anonymous requests allowed. Wrong-key requests blocked.
  const expectedKeys = (process.env.DEMO_KEY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const provided = req.headers.get("x-demo-key");
  const keyValid = !!provided && expectedKeys.includes(provided);
  if (expectedKeys.length > 0 && provided && !keyValid) {
    return new Response(JSON.stringify({ error: "Wrong demo key" }), {
      status: 403,
    });
  }
  // The solo call runs alongside whatever tree the user is running, so
  // charge it to the same bucket the tree uses.
  const solomode: "dev" | "demo" = "demo";

  const status = budgetStatus(solomode);
  if (!status.allowed) {
    return new Response(
      JSON.stringify({
        error: `Daily ${solomode} cap of $${status.capUsd.toFixed(2)} reached. Try again tomorrow.`,
      }),
      { status: 429 },
    );
  }

  const body = await req.json();
  const { prompt } = body;
  if (!prompt || typeof prompt !== "string") {
    return new Response(JSON.stringify({ error: "Need a prompt" }), {
      status: 400,
    });
  }

  // Fire-and-forget presence ping — single-Claude users should also show
  // up on the map. Same IP-hash scheme as /api/spawn.
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const sessionId = `spawn:${crypto.createHash("md5").update(ip).digest("hex").slice(0, 12)}`;
    const lat = parseFloat(req.headers.get("x-vercel-ip-latitude") ?? "");
    const lng = parseFloat(req.headers.get("x-vercel-ip-longitude") ?? "");
    const city = req.headers.get("x-vercel-ip-city");
    const country = req.headers.get("x-vercel-ip-country");
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      // Fire-and-forget; pingPresence swallows its own errors.
      void pingPresence({
        sessionId,
        lat,
        lng,
        city: city ? decodeURIComponent(city) : undefined,
        country: country || undefined,
      });
    }
  } catch {
    // never let presence break the solo call
  }

  const startedAt = Date.now();
  try {
    const result = await createMessage({
      model: "claude-sonnet-4-6", // ignored on Cerebras (uses CEREBRAS_MODEL)
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = result.text;
    // Record cost using whichever model actually answered.
    const price = MODEL_PRICES[result.model] || { input: 0, output: 0 };
    recordCost(
      result.inputTokens * price.input + result.outputTokens * price.output,
      solomode,
    );
    return new Response(
      JSON.stringify({
        text,
        elapsedMs: Date.now() - startedAt,
        model: result.model,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "API error";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
