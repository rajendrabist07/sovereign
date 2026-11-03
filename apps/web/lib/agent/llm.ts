/** JSON Schema for a tool's arguments, in the shape OpenAI-compatible APIs expect. */
export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
};

/** `arguments` is the raw JSON text the model wrote; it is never trusted. */
export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type LlmRequest = { messages: ChatMessage[]; tools: ToolSpec[] };

export type LlmResponse = {
  content: string | null;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number };
};

/**
 * The only thing the executor knows about a model. A real provider (Groq) and
 * the scripted fake used in tests both implement it, so the loop and its
 * guardrails are tested without a network or an API key.
 */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * A failure of the model provider that the caller can act on. The message is
 * written to be safe to store and to show: it never contains the provider's
 * response body, the request or the API key.
 */
export class LlmProviderError extends Error {
  readonly retryable: boolean;
  /** How long the provider asked us to wait, when it said. */
  readonly retryAfterMs: number | null;

  constructor(message: string, options: { retryable: boolean; retryAfterMs?: number | null }) {
    super(message);
    this.name = "LlmProviderError";
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/** By name and shape, not instanceof: see the note in verify-agent-step about duplicate module copies. */
export function isLlmProviderError(error: unknown): error is LlmProviderError {
  const candidate = error as { name?: unknown; retryable?: unknown } | null;
  return candidate?.name === "LlmProviderError" && typeof candidate.retryable === "boolean";
}
