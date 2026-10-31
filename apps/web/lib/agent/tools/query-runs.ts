import { z } from "@sovereign/shared";
import { defineTool } from "../tool";

export const RUN_STATUS_FILTERS = ["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const;
export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number];

export type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  createdAt: string;
};

/**
 * Read-only look at the organisation's recent runs. It reports metadata only,
 * never payloads or step outputs. The caller supplies `listRuns` already bound
 * to the tenant, so the model cannot pick whose data it reads.
 */
export function queryRunsTool(options: {
  listRuns: (query: { limit: number; status?: RunStatusFilter }) => Promise<RunSummary[]>;
}) {
  return defineTool({
    name: "query_runs",
    description:
      "List this organisation's most recent workflow runs, newest first: run id, workflow name, status and when it was created. Read-only.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 10, description: "How many runs to return" },
        status: { type: "string", enum: [...RUN_STATUS_FILTERS], description: "Only runs with this status" }
      },
      required: ["limit"],
      additionalProperties: false
    },
    shape: {
      limit: z.number().int().min(1).max(10),
      status: z.enum(RUN_STATUS_FILTERS).optional()
    },
    run: async ({ limit, status }) => ({
      runs: await options.listRuns({ limit, ...(status ? { status } : {}) })
    })
  });
}
