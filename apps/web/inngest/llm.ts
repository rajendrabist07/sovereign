import { NonRetriableError } from "inngest";
import type { LlmClient } from "../lib/agent/llm";

/**
 * Placeholder until the real provider adapter is added. An agent step fails
 * with this message instead of silently doing nothing.
 */
export function getLlmClient(): LlmClient {
  throw new NonRetriableError("No language model is configured yet");
}
