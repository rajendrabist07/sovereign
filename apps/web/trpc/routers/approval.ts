import { TRPCError } from "@trpc/server";
import { approvalDecisionInputSchema, stepSchema } from "@sovereign/shared";
import { inngest } from "../../inngest/client";
import { APPROVAL_DECIDED_EVENT } from "../../lib/runs/approval";
import { writeAudit } from "../audit";
import { adminProcedure, router, viewerProcedure } from "../init";

export const approvalRouter = router({
  /** Approvals still waiting for a decision, oldest first. */
  listPending: viewerProcedure.query(async ({ ctx }) => {
    const approvals = await ctx.db.approval.findMany({
      where: { decision: null },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      take: 50,
      include: { step: { select: { input: true, stepIndex: true } } }
    });
    const runs = await ctx.db.workflowRun.findMany({
      where: { id: { in: approvals.map((a) => a.runId) } },
      select: { id: true, workflow: { select: { name: true } } }
    });
    const workflowByRun = new Map(runs.map((r) => [r.id, r.workflow.name]));

    return approvals.map((a) => {
      const definition = stepSchema.safeParse(a.step.input);
      return {
        id: a.id,
        runId: a.runId,
        requestedAt: a.requestedAt,
        workflowName: workflowByRun.get(a.runId) ?? "Unknown workflow",
        stepName: definition.success
          ? definition.data.name
          : `Step ${a.step.stepIndex + 1}`,
        instructions:
          definition.success && definition.data.type === "MANUAL_APPROVAL"
            ? (definition.data.instructions ?? null)
            : null
      };
    });
  }),

  /**
   * Records the decision. The claim is one UPDATE ... WHERE decision IS NULL,
   * so of several simultaneous callers exactly one wins. Calling it again for
   * an already decided approval changes nothing but re-sends the wake-up
   * event while the run is still waiting, which makes a failed send
   * recoverable by simply retrying.
   */
  decide: adminProcedure
    .input(approvalDecisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const approval = await ctx.db.approval.findUnique({
        where: { id: input.approvalId },
        select: { id: true, runId: true, stepId: true }
      });
      if (!approval) throw new TRPCError({ code: "NOT_FOUND" });

      const tenantId = ctx.session.tenantId;
      const wakeRun = async () => {
        try {
          await inngest.send({
            name: APPROVAL_DECIDED_EVENT,
            data: { approvalId: approval.id, runId: approval.runId, tenantId }
          });
        } catch (cause) {
          // The decision is already committed: tell the caller to retry.
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The decision was saved but the run could not be woken. Try again.",
            cause
          });
        }
      };

      const claimed = await ctx.db.approval.updateMany({
        where: { id: approval.id, decision: null },
        data: {
          decision: input.decision,
          decidedAt: new Date(),
          decidedBy: ctx.session.userId,
          note: input.note ?? null
        }
      });

      if (claimed.count === 1) {
        await writeAudit(ctx.db, ctx.session, {
          action: "approval.decided",
          resourceType: "approval",
          resourceId: approval.id,
          metadata: { decision: input.decision, runId: approval.runId }
        });
        ctx.afterCommit(wakeRun);
        return { alreadyDecided: false as const, decision: input.decision };
      }

      // Decided earlier, by someone else or by a previous attempt.
      const current = await ctx.db.approval.findUniqueOrThrow({
        where: { id: approval.id },
        select: { decision: true }
      });
      const step = await ctx.db.runStep.findUnique({
        where: { id: approval.stepId },
        select: { status: true }
      });
      if (step?.status === "RUNNING") ctx.afterCommit(wakeRun);
      return { alreadyDecided: true as const, decision: current.decision };
    })
});
