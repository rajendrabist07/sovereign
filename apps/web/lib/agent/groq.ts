import { z } from "@sovereign/shared";
import {
  LlmProviderError,
  type ChatMessage,
  type LlmClient,
  type LlmRequest,
  type LlmResponse
} from "./llm";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_RETRY_WAIT_MS = 10_000;
/** A longer wait (a daily limit, say) is not worth holding a run for. */
export const MAX_RETRY_WAIT_MS = 120_000;

// Every message below is stored on the step and shown in the UI, so none of
// them may contain the provider's response body, the request or the key.
const MSG_TIMEOUT = "The AI provider did not answer in time";
const MSG_UNREACHABLE = "The AI provider could not be reached";
const MSG_UNREADABLE = "The AI provider sent an answer that could not be understood";

export type GroqOptions = {
  apiKey: string;
  model?: string;
  /** For tests only: never read from the environment, or a key could be sent anywhere. */
  baseUrl?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() })
              })
            )
            .nullable()
            .optional()
        })
      })
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() })
});

function toApiMessage(message: ChatMessage) {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments }
              }))
            }
          : {})
      };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function classify(status: number, retryAfterMs: number | null): LlmProviderError {
  if (status === 429) {
    if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_WAIT_MS) {
      return new LlmProviderError("The AI provider's rate limit is used up for now, try again later", {
        retryable: false
      });
    }
    return new LlmProviderError("The AI provider is rate limited", {
      retryable: true,
      retryAfterMs: retryAfterMs ?? DEFAULT_RETRY_WAIT_MS
    });
  }
  if (status === 408 || status >= 500) {
    return new LlmProviderError("The AI provider had a problem, try again", { retryable: true });
  }
  if (status === 401 || status === 403) {
    return new LlmProviderError("The AI provider rejected the API key", { retryable: false });
  }
  if (status === 404) {
    return new LlmProviderError("The AI model was not found", { retryable: false });
  }
  return new LlmProviderError("The AI provider rejected the request", { retryable: false });
}

async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * A chat client for Groq's OpenAI-compatible API. It sends the key only to the
 * configured host, never follows a redirect, and turns every failure into an
 * LlmProviderError whose message is safe to store and show.
 */
export function createGroqClient(options: GroqOptions): LlmClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("A Groq API key is required");
  const model = options.model ?? DEFAULT_GROQ_MODEL;
  const baseUrl = (options.baseUrl ?? GROQ_BASE_URL).replace(/\/+$/, "");
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const body = {
        model,
        messages: request.messages.map(toApiMessage),
        temperature: 0.2,
        max_tokens: maxOutputTokens,
        // Some providers reject an empty tools array, so it is left out.
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters
                }
              })),
              tool_choice: "auto"
            }
          : {})
      };

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        throw new LlmProviderError(isTimeout(error) ? MSG_TIMEOUT : MSG_UNREACHABLE, {
          retryable: true
        });
      }

      if (!response.ok) {
        // The body is never read: it can echo the request, and it is not needed.
        await response.body?.cancel().catch(() => undefined);
        throw classify(response.status, parseRetryAfter(response.headers.get("retry-after")));
      }

      let text: string | null;
      try {
        text = await readCapped(response);
      } catch (error) {
        throw new LlmProviderError(isTimeout(error) ? MSG_TIMEOUT : MSG_UNREACHABLE, {
          retryable: true
        });
      }
      if (text === null) {
        throw new LlmProviderError("The AI provider's answer was too large", { retryable: false });
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new LlmProviderError(MSG_UNREADABLE, { retryable: true });
      }
      const parsed = responseSchema.safeParse(json);
      const message = parsed.success ? parsed.data.choices[0]?.message : undefined;
      if (!parsed.success || !message) {
        throw new LlmProviderError(MSG_UNREADABLE, { retryable: true });
      }

      return {
        content: message.content ?? null,
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments
        })),
        usage: {
          promptTokens: parsed.data.usage.prompt_tokens,
          completionTokens: parsed.data.usage.completion_tokens
        }
      };
    }
  };
}
