import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@sovereign/db";
import { PLAN_LIMITS, quotaPeriod } from "@sovereign/shared";
import { createCaller } from "../trpc/routers/_app";
import { createChecker, requireDevStack, waitForTerminal } from "./lib";

await requireDevStack();

const { check, finish } = createChecker();
const tenantA = `verify-${randomUUID()}`;
const tenantB = `verify-${randomUUID()}`;

const as = (tenantId: string, role: "VIEWER" | "ADMIN" = "ADMIN") =>
  createCaller({ session: { userId: "verify-user", tenantId, role } });

const adminA = as(tenantA);
const adminB = as(tenantB);
const definition = {
  steps: [{ type: "WAIT" as const, name: "pause", seconds: 1 }]
};

try {
  await prisma.$connect();
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) =>
      tx.tenant.create({ data: { id, name: `Verify ${id}`, slug: id } })
    );
  }

  const flow1 = await adminA.workflow.create({ name: "flow-1", definition });
  const flow2 = await adminA.workflow.create({ name: "flow-2", definition });

  const empty = await adminA.run.list();
  check("new tenant: empty run list", empty.items.length === 0 && empty.nextCursor === null);
  const quota0 = await adminA.quota.current();
  check(
    "quota.current starts at 0 of the free limit",
    quota0.used === 0 && quota0.plan === "free" && quota0.limit === PLAN_LIMITS.free.runsPerMonth
  );

  const r1 = await adminA.run.start({ workflowId: flow1.id });
  const r2 = await adminA.run.start({ workflowId: flow1.id });
  const r3 = await adminA.run.start({ workflowId: flow2.id });

  const all = await adminA.run.list();
  check(
    "list returns runs newest first",
    JSON.stringify(all.items.map((r) => r.id)) === JSON.stringify([r3.id, r2.id, r1.id])
  );
  check(
    "list items carry the workflow name and step count",
    all.items[0]?.workflow.name === "flow-2" && all.items[0]?._count.steps === 1
  );

  const page1 = await adminA.run.list({ limit: 2 });
  const page2 = await adminA.run.list({ limit: 2, cursor: page1.nextCursor ?? undefined });
  check("pagination: page 1 has 2 items and a cursor", page1.items.length === 2 && page1.nextCursor !== null);
  check(
    "pagination: page 2 has the last item, no cursor, no overlap",
    page2.items.length === 1 && page2.nextCursor === null && page2.items[0]?.id === r1.id
  );

  const onlyFlow1 = await adminA.run.list({ workflowId: flow1.id });
  check(
    "workflowId filter returns only that workflow's runs",
    onlyFlow1.items.length === 2 && onlyFlow1.items.every((r) => r.workflowId === flow1.id)
  );

  const quota3 = await adminA.quota.current();
  check("quota.current counts the started runs", quota3.used === 3);
  check(
    "quota.current resets on the 1st of next month (UTC)",
    quota3.resetAt.toISOString() === quotaPeriod(new Date()).resetAt.toISOString()
  );

  check(
    "VIEWER can list runs and read quota",
    (await as(tenantA, "VIEWER").run.list()).items.length === 3 &&
      (await as(tenantA, "VIEWER").quota.current()).used === 3
  );

  check("tenant B sees none of tenant A's runs", (await adminB.run.list()).items.length === 0);
  check(
    "tenant B cannot probe with tenant A's run id as a cursor",
    (await adminB.run.list({ cursor: r1.id })).items.length === 0
  );
  check("tenant B's quota is independent (0 used)", (await adminB.quota.current()).used === 0);

  // Let every run finish before cleanup, so the runner never hits a deleted tenant.
  await Promise.all(
    [r1, r2, r3].map((r) => waitForTerminal(() => adminA.run.get({ id: r.id })))
  );
} finally {
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) => tx.tenant.deleteMany({ where: { id } }));
  }
  await prisma.$disconnect();
}

finish();
