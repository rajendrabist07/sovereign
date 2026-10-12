import { NonRetriableError } from "inngest";
import { withTenant } from "@sovereign/db";
import { runRequestedEventSchema, stepSchema } from "@sovereign/shared";
import { recordStep } from "../lib/runs/state";
import { inngest } from "./client";
import { executeHttpStep } from "./http-step";

/**
 * Remember the replay rule: everything outside step.run() executes again
 * on every replay, so it must be pure control flow. All DB writes and
 * network calls live inside step.run() / step.sleep().
 * Quota: each step.run() counts as one execution on the free tier.
 */
export const runWorkflow = inngest.createFunction(
  { id: "run-workflow", triggers: { event: "workflow/run.requested" } },
  async ({ event, step }) => {
    const parsed = runRequestedEventSchema.safeParse(event.data);
    if (!parsed.success) {
      throw new NonRetriableError("Invalid workflow/run.requested payload");
    }
    const { runId, tenantId } = parsed.data;

    const snapshot = await step.run("load-run", () =>
      withTenant(tenantId, async (tx) => {
        const rows = await tx.runStep.findMany({
          where: { runId },
          orderBy: { stepIndex: "asc" },
          select: { stepIndex: true, input: true }
        });
        if (rows.length === 0) {
          throw new NonRetriableError("Run not found for this tenant");
        }
        return rows.map((r) => ({
          stepIndex: r.stepIndex,
          definition: r.input as object
        }));
      })
    );

    let currentIndex = -1;
    try {
      for (const item of snapshot) {
        const i = item.stepIndex;
        currentIndex = i;
        // Validate again: the snapshot came back through the queue as JSON.
        const definition = stepSchema.parse(item.definition);

        if (definition.type === "HTTP_REQUEST") {
          await step.run(`step-${i}`, () =>
            executeHttpStep({ tenantId, runId, stepIndex: i, definition })
          );
        } else if (definition.type === "WAIT") {
          await step.run(`step-${i}-begin`, () =>
            withTenant(tenantId, (tx) =>
              recordStep(tx, runId, i, { status: "RUNNING" })
            )
          );
          // Sleeping holds no request and no DB connection.
          await step.sleep(`step-${i}-sleep`, `${definition.seconds}s`);
          await step.run(`step-${i}-end`, () =>
            withTenant(tenantId, (tx) =>
              recordStep(tx, runId, i, {
                status: "COMPLETED",
                output: { waitedSeconds: definition.seconds }
              })
            )
          );
        } else {
          throw new NonRetriableError(
            `${definition.type} steps are not supported yet`
          );
        }
      }
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      await step.run("mark-failed", () =>
        withTenant(tenantId, (tx) =>
          recordStep(tx, runId, currentIndex, { status: "FAILED", error: message })
        )
      );
      // Also mark the Inngest run itself as failed (no pointless retry).
      throw new NonRetriableError("Workflow run failed", { cause: error });
    }
  }
);
