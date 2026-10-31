import type { TenantTx } from "@sovereign/db";
import { quotaPeriod } from "@sovereign/shared";

/** Tokens this tenant has used in the month containing `at`. */
export async function tokensUsedInMonth(tx: TenantTx, tenantId: string, at: Date): Promise<number> {
  const { month } = quotaPeriod(at);
  const row = await tx.quota.findUnique({
    where: { tenantId_month: { tenantId, month } },
    select: { tokensUsed: true }
  });
  return row?.tokensUsed ?? 0;
}

/**
 * Adds to the month's token counter in one statement, creating the row if the
 * month has none yet. Call it with the same tx that records the step, so the
 * tokens and the step result commit together. `at` is the run's start time,
 * so a run that crosses midnight on the 1st is billed to the month it began.
 */
export async function addTokens(tx: TenantTx, tenantId: string, tokens: number, at: Date) {
  const amount = Math.trunc(tokens);
  if (!(amount > 0)) return;
  const { month, resetAt } = quotaPeriod(at);
  await tx.$executeRaw`
    INSERT INTO quotas ("tenantId", "month", "runsUsed", "tokensUsed", "resetAt")
    VALUES (${tenantId}, ${month}, 0, ${amount}, ${resetAt})
    ON CONFLICT ("tenantId", "month")
    DO UPDATE SET "tokensUsed" = quotas."tokensUsed" + ${amount}`;
}
