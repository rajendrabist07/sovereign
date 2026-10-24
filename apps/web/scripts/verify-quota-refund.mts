import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@sovereign/db";
import { quotaPeriod } from "@sovereign/shared";
import { inngest } from "../inngest/client";
import { createCaller } from "../trpc/routers/_app";

// No Inngest server needed: inngest.send is replaced below to simulate
// "Inngest is down" (fail) and "Inngest accepted the event" (ok).

const tenantId = `verify-${randomUUID()}`;
const admin = createCaller({
  session: { userId: "verify-user", tenantId, role: "ADMIN" }
});

const definition = {
  steps: [{ type: "WAIT" as const, name: "pause", seconds: 1 }]
};
const { month, resetAt } = quotaPeriod(new Date());

// Start above zero: refundRun floors at 0, so a seed of 0 could hide a
// missing refund.
const SEED = 5;

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

const runsUsed = async () =>
  (
    await withTenant(tenantId, (tx) =>
      tx.quota.findUnique({ where: { tenantId_month: { tenantId, month } } })
    )
  )?.runsUsed ?? null;

const originalSend = inngest.send;
function stubSend(behavior: "ok" | "fail") {
  inngest.send = (async () => {
    if (behavior === "fail") throw new Error("simulated: Inngest unreachable");
    return { ids: [] };
  }) as unknown as typeof inngest.send;
}

try {
  await prisma.$connect();
  await withTenant(tenantId, (tx) =>
    tx.tenant.create({
      data: { id: tenantId, name: `Verify${tenantId}`, slug: tenantId }
    })
  );
  await withTenant(tenantId, (tx) =>
    tx.quota.create({
      data: { tenantId, month, runsUsed: SEED, tokensUsed: 0, resetAt }
    })
  );
  const workflow = await admin.workflow.create({ name: "refund test", definition });

  // Control: a successful enqueue must keep its reservation.
  stubSend("ok");
  const okRun = await admin.run.start({ workflowId: workflow.id });
  check(
    `a successful enqueue keeps the reservation (${SEED} -> ${SEED + 1})`,
    (await runsUsed()) === SEED + 1
  );

  // The case under test: Inngest is down.
  stubSend("fail");
  const code = await codeOf(admin.run.start({ workflowId: workflow.id }));
  check("a failed enqueue surfaces as INTERNAL_SERVER_ERROR", code === "INTERNAL_SERVER_ERROR");
  check(
    `the failed enqueue gave its reservation back (still ${SEED + 1}, not ${SEED + 2})`,
    (await runsUsed()) === SEED + 1
  );

  const runs = await withTenant(tenantId, (tx) =>
    tx.workflowRun.findMany({ include: { steps: true } })
  );
  const others = runs.filter((r) => r.id !== okRun.id);
  const failedRun = others[0];
  check("the failed start left exactly one run row", others.length === 1);
  check("that run is FAILED, not PENDING forever", failedRun?.status === "FAILED");
  check(
    "its first step records why",
    failedRun?.steps[0]?.error === "Could not enqueue the run"
  );
  check(
    "the earlier successful run is untouched (PENDING)",
    runs.find((r) => r.id === okRun.id)?.status === "PENDING"
  );

  if (failures > 0) console.log("\nDebug: error code of the failing start:", code);
} finally {
  inngest.send = originalSend;
  await withTenant(tenantId, (tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
