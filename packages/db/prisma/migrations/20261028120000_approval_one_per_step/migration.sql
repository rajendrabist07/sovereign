-- One approval request per run step. The runner creates it idempotently, so a
-- retried step cannot produce a duplicate. The unique index also serves lookups
-- by stepId, so the plain index is dropped.

-- DropIndex
DROP INDEX "approvals_stepId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "approvals_stepId_key" ON "approvals"("stepId");
