import {
  AGENT_TOOLS,
  workflowDefinitionSchema,
  workflowInputSchema,
  type AgentToolName
} from "@sovereign/shared";
import { normaliseAllowedHosts } from "./net/host";

export const MAX_STEPS = 20;
export const MAX_AGENT_HOSTS = 10;
export const MAX_AGENT_LABELS = 10;
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export const METHODS_WITH_BODY: readonly HttpMethod[] = ["POST", "PUT", "PATCH"];

/**
 * What the form edits: every field is a string, because that is what an
 * <input> holds. It becomes a typed definition only after validation.
 * Hosts and labels are one per line in a textarea.
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
  | { key: string; type: "MANUAL_APPROVAL"; name: string; instructions: string }
  | {
      key: string;
      type: "AGENT";
      name: string;
      task: string;
      tools: AgentToolName[];
      allowedHosts: string;
      labels: string;
    };

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
    case "AGENT":
      return { key, type, name: "AI agent", task: "", tools: [], allowedHosts: "", labels: "" };
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

/** Non-empty, trimmed lines of a textarea, without repeats. */
function uniqueLines(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

const hostLines = (text: string): string[] => [
  ...new Set(uniqueLines(text).map((line) => line.toLowerCase()))
];

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
          case "AGENT": {
            // Hosts typed before http_get was switched off must not be saved.
            const hosts = step.tools.includes("http_get") ? hostLines(step.allowedHosts) : [];
            const labels = uniqueLines(step.labels);
            return {
              type: "AGENT" as const,
              name: step.name,
              task: step.task,
              // Saved in the schema's order, whatever order they were ticked in.
              tools: AGENT_TOOLS.filter((tool) => step.tools.includes(tool)),
              allowedHosts: hosts,
              ...(labels.length > 0 ? { labels } : {})
            };
          }
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

/** `parts` is the issue path without the leading "definition". */
function friendly(issue: IssueLike, parts: Array<string | number>): string {
  const field = parts[0] === "steps" && typeof parts[1] === "number" ? String(parts[2] ?? "") : "";
  const isItem = parts.length > 3;

  if (field === "labels") {
    if (issue.code === "too_small" && issue.type === "array") {
      return "Add at least two labels, or leave this empty";
    }
    if (issue.code === "too_big" && issue.type === "array") {
      return `Use at most ${MAX_AGENT_LABELS} labels`;
    }
    if (isItem && issue.code === "too_big") return "Each label can be at most 40 characters";
  }
  if (field === "allowedHosts" && issue.code === "too_big" && issue.type === "array") {
    return `Use at most ${MAX_AGENT_HOSTS} hosts`;
  }

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

/**
 * Rules the schema cannot express: an agent that may fetch pages needs a
 * usable host list. It uses the same host rules as the server, so a list that
 * passes here is accepted when the step runs.
 */
function agentHostErrors(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  draft.steps.forEach((step, index) => {
    if (step.type !== "AGENT" || !step.tools.includes("http_get")) return;
    const key = `steps.${index}.allowedHosts`;
    const hosts = hostLines(step.allowedHosts);
    if (hosts.length === 0) {
      errors[key] = "Add at least one host the agent may reach";
      return;
    }
    for (const host of hosts) {
      try {
        normaliseAllowedHosts([host]);
      } catch (error) {
        // By name: see the note in verify-agent-step about ESM and CommonJS copies.
        if ((error as { name?: string } | null)?.name !== "SafeFetchError") throw error;
        errors[key] = `"${host}" is not a valid host name. Use a name like api.example.com or *.example.com`;
        return;
      }
    }
  });
  return errors;
}

export function validateDraft(
  draft: Draft
): { ok: true; input: WorkflowInput } | { ok: false; errors: FieldErrors } {
  const result = workflowInputSchema.safeParse(draftToInput(draft));
  const errors: FieldErrors = {};

  if (!result.success) {
    for (const issue of result.error.issues) {
      const parts = issue.path.filter((part, i) => !(i === 0 && part === "definition"));
      // Problems inside a list field (one label, one host) show on the field itself.
      const keyParts =
        parts[0] === "steps" &&
        typeof parts[1] === "number" &&
        ["labels", "allowedHosts", "tools"].includes(String(parts[2]))
          ? parts.slice(0, 3)
          : parts;
      const key = keyParts.join(".");
      // First issue per field wins: it is the most basic thing that is wrong.
      if (!(key in errors)) errors[key] = friendly(issue as IssueLike, parts);
    }
  }
  for (const [key, message] of Object.entries(agentHostErrors(draft))) {
    if (!(key in errors)) errors[key] = message;
  }

  if (result.success && Object.keys(errors).length === 0) {
    return { ok: true, input: result.data };
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
      steps.push({
        key: newKey(),
        type: "AGENT",
        name: step.name,
        task: step.task,
        tools: [...step.tools],
        allowedHosts: step.allowedHosts.join("\n"),
        labels: (step.labels ?? []).join("\n")
      });
    } else {
      // Exhaustive: a new step type in the shared schema fails the build here
      // until the editor knows how to show it.
      const unsupported: never = step;
      return unsupported;
    }
  }
  return { name: workflow.name, steps };
}
