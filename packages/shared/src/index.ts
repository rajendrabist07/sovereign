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

export const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("HTTP_REQUEST"),
    name: stepName,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().url().max(2000),
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
