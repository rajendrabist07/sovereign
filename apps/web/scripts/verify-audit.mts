import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@sovereign/db";
import { createCaller } from "../trpc/routers/_app";

const tenantA = `verify-${randomUUID()}`;
const tenantB = `verify-${randomUUID()}`;

const as = (tenantId: string) =>
  createCaller({ session: { userId: "verify-user", tenantId, role: "ADMIN" } });

const definition = {
  steps: [{ type: "WAIT" as const, name: "pause", seconds: 5 }]
};

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

async function threw(promise: Promise<unknown>, reason?: RegExp): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch (error) {
    // Match the reason too, so a check can't pass because of an unrelated failure.
    return reason ? reason.test(String(error)) : true;
  }
}

const auditRows = (tenantId: string) =>
  withTenant(tenantId, (tx) =>
    tx.auditLog.findMany({ orderBy: { createdAt: "asc" } })
  );

try {
  // Warm the connection first so cold-connect time isn't charged to the
  // first transaction.
  await prisma.$connect();

  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) =>
      tx.tenant.create({ data: { id, name: `Verify ${id}`, slug: id } })
    );
  }

  const adminA = as(tenantA);
  const adminB = as(tenantB);

  const wf = await adminA.workflow.create({ name: "audited", definition });
  await adminA.workflow.update({ id: wf.id, name: "audited v2", definition });
  await adminA.workflow.delete({ id: wf.id });

  const rows = await auditRows(tenantA);
  check(
    "create/update/delete each wrote one audit row, in order",
    JSON.stringify(rows.map((r) => r.action)) ===
      JSON.stringify(["workflow.created", "workflow.updated", "workflow.deleted"])
  );
  check("audit rows record the actor", rows.every((r) => r.actorUserId === "verify-user"));
  check("audit rows point at the workflow", rows.every((r) => r.resourceId === wf.id));

  const target = await adminA.workflow.create({ name: "target", definition });
  const before = (await auditRows(tenantA)).length;

  check(
    "tenant B cannot update A's workflow",
    await threw(adminB.workflow.update({ id: target.id, name: "x", definition }))
  );
  check("tenant B cannot delete A's workflow", await threw(adminB.workflow.delete({ id: target.id })));
  check(
    "failed attempts wrote no audit rows (mutation + audit are one transaction)",
    (await auditRows(tenantA)).length === before && (await auditRows(tenantB)).length === 0
  );
  check(
    "tenant B cannot read tenant A's audit log",
    before > 0 && (await auditRows(tenantB)).length === 0
  );

  check(
    "UPDATE on audit_log is rejected",
    await threw(withTenant(tenantA, (tx) => tx.$executeRaw`UPDATE audit_log SET action = 'tampered'`), /permission denied|42501/i)
  );
  check(
    "DELETE on audit_log is rejected",
    await threw(withTenant(tenantA, (tx) => tx.$executeRaw`DELETE FROM audit_log`), /permission denied|42501/i)
  );
  check(
    "audit rows unchanged after tamper attempts",
    (await auditRows(tenantA)).length === before
  );
} finally {
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) => tx.tenant.deleteMany({ where: { id } }));
  }
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
