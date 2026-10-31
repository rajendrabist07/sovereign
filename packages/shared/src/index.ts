import { z } from "zod";

// Re-exported so every package uses the SAME zod instance (two copies
// of zod in one monorepo cause confusing type mismatches).
export { z };

// Ascending privilege order: later = more powerful.
export const ROLES = ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const;
export type Role = (typeof ROLES)[number];

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLES.indexOf(actual) >= ROLES.indexOf(required);
}

const stepName = z.string().trim().min(1).max(100);

/** Tools an agent step can be given. Each is read-only. */
export const AGENT_TOOLS = ["http_get", "query_runs"] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

export const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("HTTP_REQUEST"),
    name: stepName,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().url().max(2000).startsWith("https://", "Only https:// URLs are allowed"),
    body: z.string().max(10_000).optional()
  }),
  z.object({
    type: z.literal("WAIT"),
    name: stepName,
    seconds: z.number().int().min(1).max(604_800) // up to 7 days
  }),
  z.object({
    type: z.literal("MANUAL_APPROVAL"),
    name: stepName,
    instructions: z.string().max(1000).optional()
  }),
  z.object({
    type: z.literal("AGENT"),
    name: stepName,
    // Written by a workflow admin, so it is trusted. Outside data never goes here.
    task: z.string().trim().min(1).max(2000),
    tools: z.array(z.enum(AGENT_TOOLS)).max(AGENT_TOOLS.length),
    // Hosts the http_get tool may reach; checked again where the tool is built.
    allowedHosts: z.array(z.string().trim().toLowerCase().min(1).max(253)).max(10),
    // When set, the agent must answer with one of these labels and a reason.
    labels: z.array(z.string().trim().min(1).max(40)).min(2).max(10).optional()
  })
]);

// Max 20 steps: every Inngest step counts against the free-tier quota.
export const workflowDefinitionSchema = z.object({
  steps: z.array(stepSchema).min(1).max(20)
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  definition: workflowDefinitionSchema
});

export type WorkflowStep = z.infer<typeof stepSchema>;

export const RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * A run's status is DERIVED from its steps, never set by hand:
 * run_steps is the source of truth.
 */
export function deriveRunStatus(stepStatuses: readonly RunStatus[]): RunStatus {
  if (stepStatuses.some((s) => s === "FAILED")) return "FAILED";
  if (stepStatuses.length > 0 && stepStatuses.every((s) => s === "COMPLETED")) return "COMPLETED";
  if (stepStatuses.some((s) => s === "RUNNING" || s === "COMPLETED")) return "RUNNING";
  return "PENDING";
}

// Events carry IDs only, never payloads: event bodies are stored and
// logged by the queue, and the runner re-reads state under tenant RLS.
export const runRequestedEventSchema = z.object({
  runId: z.string().uuid(),
  tenantId: z.string().min(1)
});

// Monthly run limits per plan. Unknown plans fall back to the most
// restrictive one (free), never to an unlimited default.
export const PLAN_LIMITS = {
  free: { runsPerMonth: 100, tokensPerMonth: 100_000 },
  pro: { runsPerMonth: 5000, tokensPerMonth: 2_000_000 }
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  return Object.hasOwn(PLAN_LIMITS, plan)
    ? PLAN_LIMITS[plan as PlanName]
    : PLAN_LIMITS.free;
}

/** The quota row key for a moment in time: calendar month in UTC. */
export function quotaPeriod(now: Date): { month: string; resetAt: Date } {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    // Date.UTC rolls month 12 over into January of the next year.
    resetAt: new Date(Date.UTC(year, monthIndex + 1, 1))
  };
}

// Human approval gates. Events carry IDs only: the decision itself lives in
// the approvals table, which is the source of truth.
export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const approvalDecisionInputSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(APPROVAL_DECISIONS),
  note: z.string().trim().max(500).optional()
});

export const approvalDecidedEventSchema = z.object({
  approvalId: z.string().uuid(),
  runId: z.string().uuid(),
  tenantId: z.string().min(1)
});
