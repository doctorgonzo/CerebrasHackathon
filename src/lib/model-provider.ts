import Anthropic from "@anthropic-ai/sdk";

// Provider abstraction. The whole engine builds Anthropic-shaped request
// params; this module is the single place that actually talks to a model, so
// we can flip between Claude (local testing) and Gemma-on-Cerebras (hackathon)
// with one env var — MODEL_PROVIDER=cerebras | anthropic.

export type Provider = "anthropic" | "cerebras";

export const PROVIDER: Provider =
  process.env.MODEL_PROVIDER === "cerebras" ? "cerebras" : "anthropic";

const CEREBRAS_BASE_URL =
  process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1";
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
export const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "gemma-4-31b";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Normalized result so the caller doesn't care which provider answered.
export interface RawResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  model: string; // model actually used, for pricing lookup
}

type OpenAIContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: OpenAIContent;
}

// Convert an Anthropic content value (string or content blocks) into the
// OpenAI chat "content" shape. Image blocks become data-URL image_url parts;
// PDF/document blocks are dropped (the Cerebras endpoint takes images, not
// PDFs) — the webcam flow only uses images anyway.
function toOpenAIContent(content: Anthropic.MessageParam["content"]): OpenAIContent {
  if (typeof content === "string") return content;
  const parts: Exclude<OpenAIContent, string> = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image" && block.source.type === "base64") {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    }
  }
  return parts;
}

async function cerebrasCreate(
  params: Anthropic.MessageCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<RawResult> {
  const messages: OpenAIMessage[] = [];

  const sys =
    typeof params.system === "string"
      ? params.system
      : Array.isArray(params.system)
        ? params.system.map((s) => s.text).join("\n")
        : "";
  if (sys) messages.push({ role: "system", content: sys });

  for (const m of params.messages) {
    messages.push({ role: m.role, content: toOpenAIContent(m.content) });
  }

  const res = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CEREBRAS_API_KEY}`,
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      max_tokens: params.max_tokens,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `Cerebras ${res.status}: ${body.slice(0, 300)}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data?.choices?.[0]?.message?.content;
  return {
    text: typeof content === "string" ? content : "",
    inputTokens: data?.usage?.prompt_tokens ?? 0,
    outputTokens: data?.usage?.completion_tokens ?? 0,
    searches: 0, // Cerebras has no server-side web_search tool
    model: CEREBRAS_MODEL,
  };
}

async function anthropicCreate(
  params: Anthropic.MessageCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<RawResult> {
  const response = await anthropic.messages.create(params, { signal });
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  return {
    text,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    searches:
      (response.usage as { server_tool_use?: { web_search_requests?: number } })
        ?.server_tool_use?.web_search_requests || 0,
    model: params.model,
  };
}

export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<RawResult> {
  return PROVIDER === "cerebras"
    ? cerebrasCreate(params, signal)
    : anthropicCreate(params, signal);
}
