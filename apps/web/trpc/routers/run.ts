import { TRPCError } from "@trpc/server";
import { withTenant } from "@sovereign/db";
import { getPlanLimits, workflowDefinitionSchema, z } from "@sovereign/shared";
import { inngest } from "../../inngest/client";
import { refundRun, reserveRun } from "../../lib/quota/runs";
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

      // Reserve as late as possible: the reservation holds a row lock until
      // this transaction commits, and validation failures above must not
      // consume quota.
      const tenant = await ctx.db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { plan: true }
      });
      const quota = await reserveRun(
        ctx.db,
        tenantId,
        getPlanLimits(tenant.plan).runsPerMonth
      );
      if (!quota.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Monthly run limit reached (${quota.limit}). Resets on ${quota.resetAt.toISOString().slice(0, 10)}.`
        });
      }

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
          // instead of leaving it PENDING forever, and give the quota back.
          await withTenant(tenantId, async (tx) => {
            await recordStep(tx, run.id, 0, {
              status: "FAILED",
              error: "Could not enqueue the run"
            });
            await refundRun(tx, tenantId);
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not enqueue the run",
            cause
          });
        }
      });

      return run;
    }),

  list: viewerProcedure
    .input(
      z
        .object({
          workflowId: z.string().uuid().optional(),
          cursor: z.string().uuid().nullish(),
          limit: z.number().int().min(1).max(100).default(25)
        })
        .default({})
    )
    .query(async ({ ctx, input }) => {
      // Fetch one extra row to learn whether another page exists.
      const rows = await ctx.db.workflowRun.findMany({
        where: input.workflowId ? { workflowId: input.workflowId } : undefined,
        // id breaks ties so paging stays stable for identical timestamps.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          workflow: { select: { name: true } },
          _count: { select: { steps: true } }
        }
      });
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items,
        nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null
      };
    }),

  get: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.workflowRun.findUnique({
        where: { id: input.id },
        include: {
          workflow: { select: { name: true, status: true } },
          steps: { orderBy: { stepIndex: "asc" } }
        }
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    })
});
