/*
  Warnings:

  - Added the required column `tenantId` to the `approvals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `run_steps` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "approvals" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "run_steps" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "approvals_tenantId_idx" ON "approvals"("tenantId");

-- CreateIndex
CREATE INDEX "run_steps_tenantId_idx" ON "run_steps"("tenantId");

-- AddForeignKey
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
