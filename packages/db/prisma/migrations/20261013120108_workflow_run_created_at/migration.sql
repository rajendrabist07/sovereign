-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "workflow_runs_tenantId_createdAt_idx" ON "workflow_runs"("tenantId", "createdAt");
