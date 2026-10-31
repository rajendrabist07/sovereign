import { workflowDefinitionSchema, workflowInputSchema } from "@sovereign/shared";

export const MAX_STEPS = 20;
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export const METHODS_WITH_BODY: readonly HttpMethod[] = ["POST", "PUT", "PATCH"];

/**
 * What the form edits: every field is a string, because that is what an
 * <input> holds. It becomes a typed definition only after validation.
 */
export type DraftStep =
  | {
      key: string;
      type: "HTTP_REQUEST";
      name: string;
      method: HttpMethod;
      url: string;
      body: string;
    }
  | { key: string; type: "WAIT"; name: string; seconds: string }
  | { key: string; type: "MANUAL_APPROVAL"; name: string; instructions: string };

export type Draft = { name: string; steps: DraftStep[] };

/** Keys: "name", "steps" (list level) and "steps.<index>.<field>". */
export type FieldErrors = Record<string, string>;

type WorkflowInput = ReturnType<typeof workflowInputSchema.parse>;

export function newStep(type: DraftStep["type"], key: string): DraftStep {
  switch (type) {
    case "WAIT":
      return { key, type, name: "Wait", seconds: "60" };
    case "MANUAL_APPROVAL":
      return { key, type, name: "Wait for approval", instructions: "" };
    case "HTTP_REQUEST":
      return { key, type, name: "Call an API", method: "GET", url: "", body: "" };
  }
}

export function moveStep<T>(items: readonly T[], from: number, to: number): T[] {
  const inRange = (i: number) => i >= 0 && i < items.length;
  if (from === to || !inRange(from) || !inRange(to)) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function draftToInput(draft: Draft) {
  return {
    name: draft.name,
    definition: {
      steps: draft.steps.map((step) => {
        switch (step.type) {
          case "WAIT":
            return {
              type: "WAIT" as const,
              name: step.name,
              seconds: step.seconds.trim() === "" ? Number.NaN : Number(step.seconds)
            };
          case "MANUAL_APPROVAL":
            return {
              type: "MANUAL_APPROVAL" as const,
              name: step.name,
              // Blank instructions are left out rather than sent as "".
              ...(step.instructions.trim() ? { instructions: step.instructions.trim() } : {})
            };
          case "HTTP_REQUEST":
            return {
              type: "HTTP_REQUEST" as const,
              name: step.name,
              method: step.method,
              url: step.url.trim(),
              // A body typed before switching to GET must not be sent.
              ...(METHODS_WITH_BODY.includes(step.method) && step.body.trim()
                ? { body: step.body }
                : {})
            };
        }
      })
    }
  };
}

type IssueLike = {
  code: string;
  type?: string;
  received?: string;
  validation?: unknown;
  message: string;
  path: Array<string | number>;
};

function friendly(issue: IssueLike): string {
  if (issue.code === "invalid_type" && issue.received === "nan") {
    return "Enter a number of seconds";
  }
  if (issue.code === "invalid_string" && issue.validation === "url") {
    return "Enter a full URL, for example https://example.com/health";
  }
  if (issue.code === "too_small") {
    if (issue.type === "string") return "Required";
    if (issue.type === "number") return "Must be at least 1 second";
    if (issue.type === "array") return "Add at least one step";
  }
  if (issue.code === "too_big") {
    if (issue.type === "number") return "Must be 7 days (604800 seconds) or less";
    if (issue.type === "array") return `A workflow can have at most ${MAX_STEPS} steps`;
    if (issue.type === "string") return "Too long";
  }
  return issue.message;
}

export function validateDraft(
  draft: Draft
): { ok: true; input: WorkflowInput } | { ok: false; errors: FieldErrors } {
  const result = workflowInputSchema.safeParse(draftToInput(draft));
  if (result.success) return { ok: true, input: result.data };

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path
      .filter((part, i) => !(i === 0 && part === "definition"))
      .join(".");
    // First issue per field wins: it is the most basic thing that is wrong.
    if (!(key in errors)) errors[key] = friendly(issue as IssueLike);
  }
  return { ok: false, errors };
}

/** Null when the editor cannot represent this workflow (its saved definition is invalid). */
export function workflowToDraft(
  workflow: { name: string; definition: unknown },
  newKey: () => string
): Draft | null {
  const parsed = workflowDefinitionSchema.safeParse(workflow.definition);
  if (!parsed.success) return null;

  const steps: DraftStep[] = [];
  for (const step of parsed.data.steps) {
    if (step.type === "HTTP_REQUEST") {
      steps.push({
        key: newKey(),
        type: "HTTP_REQUEST",
        name: step.name,
        method: step.method,
        url: step.url,
        body: step.body ?? ""
      });
    } else if (step.type === "WAIT") {
      steps.push({
        key: newKey(),
        type: "WAIT",
        name: step.name,
        seconds: String(step.seconds)
      });
    } else if (step.type === "MANUAL_APPROVAL") {
      steps.push({
        key: newKey(),
        type: "MANUAL_APPROVAL",
        name: step.name,
        instructions: step.instructions ?? ""
      });
    } else if (step.type === "AGENT") {
      // The builder cannot edit agent steps yet.
      return null;
    } else {
      // Exhaustive: a new step type in the shared schema fails the build here
      // until the editor knows how to show it.
      const unsupported: never = step;
      return unsupported;
    }
  }
  return { name: workflow.name, steps };
}
