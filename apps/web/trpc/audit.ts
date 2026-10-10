import type { TenantTx } from "@sovereign/db";
import type { Session } from "./init";

// A union (not string) so a typo in an action name fails at compile time.
export type AuditAction =
  | "workflow.created"
  | "workflow.updated"
  | "workflow.deleted";

/**
 * Must be called with the SAME tx the mutation used (ctx.db), so the
 * mutation and its audit row commit or roll back together.
 * Keep metadata small and non-sensitive: never store payloads or secrets.
 */
export async function writeAudit(
  tx: TenantTx,
  session: Session,
  entry: {
    action: AuditAction;
    resourceType: "workflow";
    resourceId: string;
    metadata?: Record<string, string | number | boolean>;
  }
) {
  await tx.auditLog.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata
    }
  });
}
