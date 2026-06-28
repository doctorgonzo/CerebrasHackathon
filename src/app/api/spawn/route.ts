import crypto from "node:crypto";
import { runAgentTree } from "@/lib/agent-engine";
import { AgentEvent, SpawnRequest } from "@/lib/types";
import { budgetStatus, recordCost } from "@/lib/budget";
import { pingPresence } from "@/lib/presence";

export const maxDuration = 300;

export async function POST(req: Request) {
  // Demo token gate. Anonymous requests are allowed (and forced to dev
  // mode client-side). If a key IS provided, it must match one of the
  // server's DEMO_KEY values (comma-separated) — wrong key gets 403.
  const expectedKeys = (process.env.DEMO_KEY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const provided = req.headers.get("x-demo-key");
  const keyValid = !!provided && expectedKeys.includes(provided);
  if (expectedKeys.length > 0 && provided && !keyValid) {
    return new Response(
      JSON.stringify({ error: "Wrong demo key" }),
      { status: 403 },
    );
  }

  const body: SpawnRequest = await req.json();
  const { prompt, file, files, mode, role, memory } = body;
  // Hackathon build: ALWAYS run at max capacity (demo mode). The old dev/demo
  // gating was cost-protection for the public multi-tenant app; here we always
  // want the full-depth, full-width swarm.
  const appMode: "dev" | "demo" = "demo";

  // Per-mode daily budget cap (dev and demo have separate buckets).
  const status = budgetStatus(appMode);
  if (!status.allowed) {
    const label = appMode === "demo" ? "demo" : "dev";
    return new Response(
      JSON.stringify({
        error: `Daily ${label} cap of $${status.capUsd.toFixed(2)} reached. Already spent $${status.spentUsd.toFixed(4)} today. Try again tomorrow.`,
      }),
      { status: 429 },
    );
  }

  // Normalize to a files array — legacy single `file` still works.
  const allFiles = files && files.length > 0 ? files : file ? [file] : [];

  if (!prompt && allFiles.length === 0) {
    return new Response(JSON.stringify({ error: "Need a prompt or file" }), {
      status: 400,
    });
  }

  // Fire-and-forget presence ping so actual tool users show up on the map,
  // not just page visitors. IP-hashed sessionId so it's anonymous but
  // deterministic per caller.
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
      pingPresence({
        sessionId,
        lat,
        lng,
        city: city ? decodeURIComponent(city) : undefined,
        country: country || undefined,
      });
    }
  } catch {
    // never let presence break a spawn
  }

  const encoder = new TextEncoder();

  const abort = new AbortController();

  try {
    req.signal.addEventListener("abort", () => abort.abort());
  } catch {
    // some runtimes don't support req.signal
  }

  const stream = new ReadableStream({
    async start(controller) {
      let runCost = 0;
      const emit = (event: AgentEvent) => {
        if (event.type === "cost_update") {
          runCost = event.totalCost;
        }
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // stream closed
        }
      };

      try {
        await runAgentTree(prompt, allFiles, emit, abort.signal, mode, role, memory, appMode);
      } catch (err) {
        if (!abort.signal.aborted) {
          const msg = err instanceof Error ? err.message : "Engine failed";
          emit({ type: "agent_error", id: "root", error: msg });
        }
        emit({ type: "done" });
      }

      // Record this run's cost against the daily cap.
      recordCost(runCost, appMode);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
