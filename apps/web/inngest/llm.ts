import { NonRetriableError } from "inngest";
import { createGroqClient } from "../lib/agent/groq";
import type { LlmClient } from "../lib/agent/llm";

/**
 * The language model for agent steps. Without a key the step fails with a
 * clear message instead of silently doing nothing.
 */
export function getLlmClient(): LlmClient {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new NonRetriableError("No language model is configured yet");
  const model = process.env.GROQ_MODEL?.trim();
  return createGroqClient({ apiKey, ...(model ? { model } : {}) });
}
