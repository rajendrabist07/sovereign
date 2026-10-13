import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@sovereign/db";
import { PLAN_LIMITS, getPlanLimits, quotaPeriod } from "@sovereign/shared";
import { createCaller } from "../trpc/routers/_app";

async function requireService(name: string, url: string, hint: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`${name} is not reachable at ${url}. ${hint}`);
    process.exit(2);
  }
}

await requireService("Inngest dev server", "http://localhost:8288", "Start it in a separate terminal (npx inngest-cli dev).");
await requireService("Next.js app", "http://localhost:3000/api/inngest", "Run pnpm dev from the repo root.");

const tenantA = `verify-${randomUUID()}`;
const tenantB = `verify-${randomUUID()}`;

const asAdmin = (tenantId: string) =>
  createCaller({ session: { userId: "verify-user", tenantId, role: "ADMIN" } });
const adminA = asAdmin(tenantA);
const adminB = asAdmin(tenantB);

const definition = {
  steps: [{ type: "WAIT" as const, name: "pause", seconds: 1 }]
};
const { month, resetAt } = quotaPeriod(new Date());

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    const e = error as { name?: string; code?: string };
    return e?.name === "TRPCError" && e.code ? e.code : "UNEXPECTED_ERROR";
  }
}

const quotaRow = (tenantId: string) =>
  withTenant(tenantId, (tx) =>
    tx.quota.findUnique({ where: { tenantId_month: { tenantId, month } } })
  );

async function waitForTerminal(caller: ReturnType<typeof asAdmin>, runId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await caller.run.get({ id: runId });
    if (run.status === "COMPLETED" || run.status === "FAILED") return run;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`run ${runId} did not finish in time`);
}

try {
  const december = quotaPeriod(new Date("2026-12-15T10:00:00Z"));
  check(
    "quota period rolls over the year (2026-12 resets 2027-01-01)",
    december.month === "2026-12" && december.resetAt.toISOString() === "2027-01-01T00:00:00.000Z"
  );
  check(
    "unknown plan falls back to the free limits",
    getPlanLimits("nonsense").runsPerMonth === PLAN_LIMITS.free.runsPerMonth
  );

  await prisma.$connect();
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) =>
      tx.tenant.create({ data: { id, name: `Verify ${id}`, slug: id } })
    );
  }

  const flowA = await adminA.workflow.create({ name: "quota-a", definition });
  const flowB = await adminB.workflow.create({ name: "quota-b", definition });

  check(
    "a start that fails validation (NOT_FOUND) consumes no quota",
    (await codeOf(adminB.run.start({ workflowId: randomUUID() }))) === "NOT_FOUND" &&
      (await quotaRow(tenantB)) === null
  );

  const runB = await adminB.run.start({ workflowId: flowB.id });
  const rowB = await quotaRow(tenantB);
  check(
    "first run creates the quota row (used 1, current month, resets next month)",
    rowB?.runsUsed === 1 && rowB.month === month && rowB.resetAt.toISOString() === resetAt.toISOString()
  );

  const limit = PLAN_LIMITS.free.runsPerMonth;
  await withTenant(tenantA, (tx) =>
    tx.quota.create({ data: { tenantId: tenantA, month, runsUsed: limit - 1, resetAt } })
  );

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => adminA.run.start({ workflowId: flowA.id }))
  );
  let acceptedId: string | undefined;
  let accepted = 0;
  const rejectedCodes: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      accepted++;
      acceptedId = result.value.id;
    } else {
      rejectedCodes.push((result.reason as { code?: string }).code ?? "UNKNOWN");
    }
  }

  check(`exactly one of 5 concurrent starts is accepted at ${limit - 1}/${limit}`, accepted === 1);
  check(
    "the other 4 are rejected with TOO_MANY_REQUESTS",
    rejectedCodes.length === 4 && rejectedCodes.every((c) => c === "TOO_MANY_REQUESTS")
  );
  check(
    `usage ends at exactly ${limit} (no overshoot)`,
    (await quotaRow(tenantA))?.runsUsed === limit
  );
  check(
    "rejected starts left no run rows behind",
    (await withTenant(tenantA, (tx) => tx.workflowRun.count())) === 1
  );

  const finishedB = await waitForTerminal(adminB, runB.id);
  const finishedA = acceptedId ? await waitForTerminal(adminA, acceptedId) : null;
  check(
    "accepted runs complete normally",
    finishedB.status === "COMPLETED" && finishedA?.status === "COMPLETED"
  );

  if (failures > 0) console.log("\nDebug: rejected codes:", rejectedCodes);
} finally {
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) => tx.tenant.deleteMany({ where: { id } }));
  }
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
