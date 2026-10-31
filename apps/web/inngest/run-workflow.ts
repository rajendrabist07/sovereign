import { NonRetriableError } from "inngest";
import { withTenant } from "@sovereign/db";
import { runRequestedEventSchema, stepSchema } from "@sovereign/shared";
import {
  APPROVAL_DECIDED_EVENT,
  APPROVAL_TIMEOUT,
  approvalOutcome
} from "../lib/runs/approval";
import { recordStep } from "../lib/runs/state";
import { inngest } from "./client";
import { executeAgentStep } from "./agent-step";
import { executeHttpStep } from "./http-step";
import { getLlmClient } from "./llm";

/**
 * Remember the replay rule: everything outside step.run() executes again
 * on every replay, so it must be pure control flow. All DB writes and
 * network calls live inside step.run() / step.sleep().
 * Quota: each step.run() counts as one execution on the free tier. An
 * approval step costs three (request, wait, finish).
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
        } else if (definition.type === "MANUAL_APPROVAL") {
          // 1. Create the request (once, even if this step is retried) and
          //    mark the step as waiting. The unique index on stepId makes the
          //    insert idempotent.
          const approvalId = await step.run(`step-${i}-request`, () =>
            withTenant(tenantId, async (tx) => {
              const row = await tx.runStep.findFirstOrThrow({
                where: { runId, stepIndex: i },
                select: { id: true }
              });
              await tx.approval.createMany({
                data: [{ tenantId, runId, stepId: row.id }],
                skipDuplicates: true
              });
              const approval = await tx.approval.findUniqueOrThrow({
                where: { stepId: row.id },
                select: { id: true }
              });
              await recordStep(tx, runId, i, { status: "RUNNING" });
              return approval.id;
            })
          );

          // 2. Sleep until a decision event arrives or the timeout passes.
          //    Only events sent AFTER this step starts are caught, so the
          //    event is a nudge: the decision itself is read from the DB.
          //    approvalId is a uuid from our own database, never user input.
          const wake = await step.waitForEvent(`step-${i}-wait`, {
            event: APPROVAL_DECIDED_EVENT,
            timeout: APPROVAL_TIMEOUT,
            if: `event.data.runId == async.data.runId && async.data.approvalId == '${approvalId}'`
          });

          // 3. Read the decision and finish (or fail) the step.
          await step.run(`step-${i}-finish`, () =>
            withTenant(tenantId, async (tx) => {
              const row = await tx.approval.findUnique({
                where: { id: approvalId },
                select: { decision: true, decidedBy: true, note: true }
              });
              const outcome = approvalOutcome(row, wake === null);
              // A rejection or expiry fails the run through the same path as
              // any other failing step.
              if (outcome.status === "FAILED") {
                throw new NonRetriableError(outcome.error);
              }
              await recordStep(tx, runId, i, {
                status: "COMPLETED",
                output: outcome.output
              });
            })
          );
        } else if (definition.type === "AGENT") {
          // The model call and its tools run outside any database transaction.
          // A model-client error such as a rate limit is retried by Inngest;
          // an agent that fails its own checks is not.
          await step.run(`step-${i}`, () =>
            executeAgentStep({
              tenantId,
              runId,
              stepIndex: i,
              definition,
              llm: getLlmClient()
            })
          );
        } else {
          // Compile-time exhaustiveness: adding a step type to the shared
          // schema fails the build here until the runner handles it.
          const unsupported: never = definition;
          throw new NonRetriableError(
            `Unsupported step: ${JSON.stringify(unsupported)}`
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
