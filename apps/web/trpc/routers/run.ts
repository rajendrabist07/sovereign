import { TRPCError } from "@trpc/server";
import { withTenant } from "@sovereign/db";
import { workflowDefinitionSchema, z } from "@sovereign/shared";
import { inngest } from "../../inngest/client";
import { recordStep } from "../../lib/runs/state";
import { writeAudit } from "../audit";
import { memberProcedure, router, viewerProcedure } from "../init";

export const runRouter = router({
  start: memberProcedure
    .input(
      z.object({
        workflowId: z.string().uuid(),
        payload: z.record(z.string(), z.string()).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.db.workflow.findUnique({
        where: { id: input.workflowId }
      });
      if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
      if (workflow.status === "ARCHIVED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Archived workflows cannot be run"
        });
      }

      const definition = workflowDefinitionSchema.parse(workflow.definition);
      const tenantId = ctx.session.tenantId;

      const run = await ctx.db.workflowRun.create({
        data: { workflowId: workflow.id, tenantId, triggerPayload: input.payload }
      });
      // Snapshot of the definition: later edits never affect this run.
      await ctx.db.runStep.createMany({
        data: definition.steps.map((step, stepIndex) => ({
          runId: run.id,
          tenantId,
          stepIndex,
          type: step.type,
          input: step
        }))
      });
      await writeAudit(ctx.db, ctx.session, {
        action: "run.requested",
        resourceType: "run",
        resourceId: run.id,
        metadata: { workflowId: workflow.id, steps: definition.steps.length }
      });

      ctx.afterCommit(async () => {
        try {
          await inngest.send({
            name: "workflow/run.requested",
            data: { runId: run.id, tenantId }
          });
        } catch (cause) {
          // The run row is committed but will never start: record that
          // instead of leaving it PENDING forever.
          await withTenant(tenantId, (tx) =>
            recordStep(tx, run.id, 0, {
              status: "FAILED",
              error: "Could not enqueue the run"
            })
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not enqueue the run",
            cause
          });
        }
      });

      return run;
    }),

  get: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.workflowRun.findUnique({
        where: { id: input.id },
        include: { steps: { orderBy: { stepIndex: "asc" } } }
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    })
});
