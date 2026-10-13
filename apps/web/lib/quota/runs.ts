import type { TenantTx } from "@sovereign/db";
import { quotaPeriod } from "@sovereign/shared";

export type Reservation =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; limit: number; resetAt: Date };

/**
 * Atomically reserves one run for this tenant and month. Check and
 * increment are ONE statement: concurrent callers queue on the row lock,
 * and each one re-evaluates the WHERE against the already-updated count,
 * so usage can never overshoot the limit. Call it with the same tx that
 * creates the run: a rollback then un-reserves automatically.
 */
export async function reserveRun(
  tx: TenantTx,
  tenantId: string,
  limit: number,
  now = new Date()
): Promise<Reservation> {
  const { month, resetAt } = quotaPeriod(now);
  if (limit <= 0) return { allowed: false, limit, resetAt };

  const rows = await tx.$queryRaw<Array<{ runsUsed: number }>>`
    INSERT INTO quotas ("tenantId", "month", "runsUsed", "tokensUsed", "resetAt")
    VALUES (${tenantId}, ${month}, 1, 0, ${resetAt})
    ON CONFLICT ("tenantId", "month")
    DO UPDATE SET "runsUsed" = quotas."runsUsed" + 1
    WHERE quotas."runsUsed" < ${limit}
    RETURNING "runsUsed"`;

  const row = rows[0];
  return row
    ? { allowed: true, used: row.runsUsed, limit }
    : { allowed: false, limit, resetAt };
}

/** Gives back one reservation, e.g. when we failed to enqueue the run. */
export async function refundRun(tx: TenantTx, tenantId: string, now = new Date()) {
  const { month } = quotaPeriod(now);
  await tx.$executeRaw`
    UPDATE quotas
    SET "runsUsed" = GREATEST("runsUsed" - 1, 0)
    WHERE "tenantId" = ${tenantId} AND "month" = ${month}`;
}
