import { getPlanLimits, quotaPeriod } from "@sovereign/shared";
import { router, viewerProcedure } from "../init";

export const quotaRouter = router({
  /** This tenant's run usage for the current month (read-only). */
  current: viewerProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.session.tenantId;
    const { month, resetAt } = quotaPeriod(new Date());

    const tenant = await ctx.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true }
    });
    const row = await ctx.db.quota.findUnique({
      where: { tenantId_month: { tenantId, month } }
    });

    return {
      plan: tenant.plan,
      month,
      used: row?.runsUsed ?? 0,
      limit: getPlanLimits(tenant.plan).runsPerMonth,
      resetAt
    };
  })
});
