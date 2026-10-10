import { TRPCError } from "@trpc/server";
import { workflowInputSchema, z } from "@sovereign/shared";
import { writeAudit } from "../audit";
import { adminProcedure, router, viewerProcedure } from "../init";

const idInput = z.object({ id: z.string().uuid() });

export const workflowRouter = router({
  list: viewerProcedure.query(({ ctx }) =>
    ctx.db.workflow.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  ),

  get: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    const workflow = await ctx.db.workflow.findUnique({
      where: { id: input.id }
    });
    // RLS hides other tenants' rows, so a foreign id looks exactly like
    // a missing one: NOT_FOUND, never FORBIDDEN (which would leak that
    // the id exists).
    if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
    return workflow;
  }),

  create: adminProcedure
    .input(workflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.db.workflow.create({
        data: {
          tenantId: ctx.session.tenantId,
          name: input.name,
          definition: input.definition,
          createdBy: ctx.session.userId
        }
      });
      await writeAudit(ctx.db, ctx.session, {
        action: "workflow.created",
        resourceType: "workflow",
        resourceId: workflow.id,
        metadata: { name: workflow.name, steps: input.definition.steps.length }
      });
      return workflow;
    }),

  update: adminProcedure
    .input(workflowInputSchema.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.workflow.updateMany({
        where: { id: input.id },
        data: { name: input.name, definition: input.definition }
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      const workflow = await ctx.db.workflow.findUniqueOrThrow({
        where: { id: input.id }
      });
      await writeAudit(ctx.db, ctx.session, {
        action: "workflow.updated",
        resourceType: "workflow",
        resourceId: workflow.id,
        metadata: { name: workflow.name, steps: input.definition.steps.length }
      });
      return workflow;
    }),

  delete: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const { count } = await ctx.db.workflow.deleteMany({
      where: { id: input.id }
    });
    if (count === 0) throw new TRPCError({ code: "NOT_FOUND" });
    await writeAudit(ctx.db, ctx.session, {
      action: "workflow.deleted",
      resourceType: "workflow",
      resourceId: input.id
    });
    return { id: input.id };
  })
});
