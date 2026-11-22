/** Shown when nothing safer is known about a failure. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * What the server sends in place of an internal error. The reference is the
 * same one written next to the real error in the server log, so a person can
 * quote it and we can find what actually happened.
 */
export function internalErrorMessage(ref: string): string {
  return `Something went wrong on our side (ref ${ref}). Please try again.`;
}

const INTERNAL_PATTERN = /^Something went wrong on our side \(ref [0-9a-f]{8}\)\. Please try again\.$/;

// Codes whose messages we write ourselves, for the person using the app.
const AUTHORED_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS"
]);

// tRPC uses the code as the message when none was given.
const WHEN_NO_MESSAGE: Record<string, string> = {
  NOT_FOUND: "We couldn't find that.",
  FORBIDDEN: "You don't have permission to do that.",
  UNAUTHORIZED: "Please sign in again."
};

/**
 * The text to show for a failed request. Only messages we wrote ourselves, and
 * the masked internal-error message, get through: anything else (a database
 * error that was not masked, a validation dump, a network failure) becomes the
 * generic text, so a raw error can never reach the screen from here.
 */
export function friendlyMessage(error: unknown): string {
  const candidate = error as { message?: unknown; data?: { code?: unknown } | null } | null;
  const message = typeof candidate?.message === "string" ? candidate.message.trim() : "";
  const code = candidate?.data?.code;
  if (!message || typeof code !== "string") return GENERIC_ERROR;

  if (code === "INTERNAL_SERVER_ERROR") {
    return INTERNAL_PATTERN.test(message) ? message : GENERIC_ERROR;
  }
  if (!AUTHORED_CODES.has(code)) return GENERIC_ERROR;
  return message === code ? (WHEN_NO_MESSAGE[code] ?? GENERIC_ERROR) : message;
}

/** A failure whose message we wrote for the person: safe to store and to show. */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}

/** Short reference that links a screen to a server log line. Works in browser and Node. */
export function newRef(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function unexpectedStepMessage(ref: string): string {
  return `This step failed unexpectedly (ref ${ref}).`;
}

// Matched by name, not instanceof: Inngest rebuilds an error that crossed
// step.run() as a plain Error, so the class is gone but the name survives.
const STEP_AUTHORED_NAMES = new Set([
  "AgentError",
  "SafeFetchError",
  "LlmProviderError",
  "ToolError",
  "NonRetriableError",
  "RetryAfterError",
  "PublicError"
]);

/**
 * The text stored on a failed step, and so shown in the run timeline. Only
 * errors we wrote ourselves keep their message; anything else becomes a
 * generic text with a reference (the caller logs the real error with it).
 */
export function publicStepError(error: unknown, ref: string): string {
  const candidate = error as { name?: unknown; message?: unknown } | null;
  const authored =
    typeof candidate?.name === "string" &&
    STEP_AUTHORED_NAMES.has(candidate.name) &&
    typeof candidate.message === "string" &&
    candidate.message.length > 0;
  return authored ? (candidate!.message as string).slice(0, 500) : unexpectedStepMessage(ref);
}

/** The Run button: its own wording for FORBIDDEN, everything else as friendlyMessage. */
export function startRunMessage(error: unknown): string {
  const code = (error as { data?: { code?: unknown } | null } | null)?.data?.code;
  if (code === "FORBIDDEN") return "You need the member role to run workflows.";
  return friendlyMessage(error);
}
