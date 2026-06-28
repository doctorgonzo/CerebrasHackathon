// Web search, provider-agnostic. Gemma-on-Cerebras has NO built-in web search
// (unlike Claude's server-side web_search tool), so when we run on Cerebras we
// bring our own: Tavily — a search API built for LLM agents that returns clean,
// already-condensed snippets in a single call. The engine calls webSearch()
// directly (no model tool-calling loop), which is fast and reliable, and plays
// to Cerebras's speed: several cheap Gemma calls + a couple of HTTP searches all
// resolve in well under a second.

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

// True only when a key is configured. Callers use this to decide whether to
// search at all — better to return NO live data than to let an agent pretend it
// searched and hallucinate "current" numbers.
export const SEARCH_ENABLED = !!TAVILY_API_KEY;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

// Run one search. Returns a compact, source-cited markdown block ready to drop
// into a prompt, or null on any failure (no key, network error, empty results)
// so the caller can degrade gracefully.
export async function webSearch(
  query: string,
  signal?: AbortSignal,
  maxResults = 5,
): Promise<string | null> {
  if (!TAVILY_API_KEY) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: "basic", // 1 credit, fast — matches the Cerebras speed story
        max_results: maxResults,
        include_answer: true,
      }),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as TavilyResponse;
    const lines: string[] = [];
    if (data.answer) lines.push(`Summary: ${data.answer}`);
    for (const r of data.results ?? []) {
      const snippet = (r.content ?? "").replace(/\s+/g, " ").slice(0, 400);
      if (snippet) lines.push(`- ${snippet} (source: ${r.url ?? "?"})`);
    }
    const out = lines.join("\n").trim();
    return out || null;
  } catch {
    return null;
  }
}

// Search several queries in parallel and label each block by its query, so the
// synthesizing model knows which facts came from which search.
export async function webSearchMany(
  queries: string[],
  signal?: AbortSignal,
): Promise<string | null> {
  const blocks = await Promise.all(
    queries.map(async (q) => {
      const r = await webSearch(q, signal);
      return r ? `### Search: "${q}"\n${r}` : null;
    }),
  );
  const combined = blocks.filter(Boolean).join("\n\n").trim();
  return combined || null;
}
