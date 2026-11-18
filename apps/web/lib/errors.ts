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
