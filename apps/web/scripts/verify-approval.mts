import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma, withTenant } from "@sovereign/db";
import { inngest } from "../inngest/client";
import { createCaller } from "../trpc/routers/_app";

async function requireService(name: string, url: string, hint: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`${name} is not reachable at ${url}. ${hint}`);
    process.exit(2);
  }
}

await requireService("Inngest dev server", "http://localhost:8288", "Run pnpm run verify-stack, or start pnpm run dev:all.");
await requireService("Next.js app", "http://localhost:3000/api/inngest", "Run pnpm run verify-stack, or start pnpm run dev:all.");

const tenantA = `verify-${randomUUID()}`;
const tenantB = `verify-${randomUUID()}`;

type TestRole = "VIEWER" | "MEMBER" | "ADMIN";
const as = (tenantId: string, role: TestRole) =>
  createCaller({ session: { userId: `verify-${role.toLowerCase()}`, tenantId, role } });
const admin = as(tenantA, "ADMIN");
const adminB = as(tenantB, "ADMIN");

const definition = {
  steps: [
    { type: "WAIT" as const, name: "before", seconds: 1 },
    { type: "MANUAL_APPROVAL" as const, name: "sign-off", instructions: "Check the numbers" },
    { type: "WAIT" as const, name: "after", seconds: 1 }
  ]
};

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

async function until<T>(label: string, fn: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined) return value;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const pendingFor = (runId: string) =>
  until("the approval request", async () =>
    (await admin.approval.listPending()).find((a) => a.runId === runId)
  );

const finished = (runId: string) =>
  until(
    "the run to finish",
    async () => {
      const run = await admin.run.get({ id: runId });
      return run.status === "COMPLETED" || run.status === "FAILED" ? run : undefined;
    },
    90_000
  );

const auditCount = () =>
  withTenant(tenantA, (tx) => tx.auditLog.count({ where: { action: "approval.decided" } }));
const approvalRow = (id: string) =>
  withTenant(tenantA, (tx) => tx.approval.findUnique({ where: { id } }));

const realSend = inngest.send;

try {
  await prisma.$connect();
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) =>
      tx.tenant.create({ data: { id, name: `Verify${id}`, slug: id } })
    );
  }
  const workflow = await admin.workflow.create({ name: "approval test", definition });

  // Flow 1: approve, with access control and a race.
  const run1 = await admin.run.start({ workflowId: workflow.id });
  const pending1 = await pendingFor(run1.id);
  check(
    "the request names the workflow and step and carries the instructions",
    pending1.workflowName === "approval test" &&
      pending1.stepName === "sign-off" &&
      pending1.instructions === "Check the numbers"
  );
  await sleep(3000);
  const waiting = await admin.run.get({ id: run1.id });
  check("the run stays RUNNING while it waits", waiting.status === "RUNNING");
  check(
    "the approval step is RUNNING and the step after it has not started",
    waiting.steps[1]?.status === "RUNNING" && waiting.steps[2]?.status === "PENDING"
  );

  check(
    "a VIEWER can see pending approvals",
    (await as(tenantA, "VIEWER").approval.listPending()).length === 1
  );
  check(
    "a VIEWER cannot decide -> FORBIDDEN",
    (await codeOf(as(tenantA, "VIEWER").approval.decide({ approvalId: pending1.id, decision: "APPROVED" }))) === "FORBIDDEN"
  );
  check(
    "a MEMBER cannot decide -> FORBIDDEN",
    (await codeOf(as(tenantA, "MEMBER").approval.decide({ approvalId: pending1.id, decision: "APPROVED" }))) === "FORBIDDEN"
  );
  check(
    "tenant B cannot decide tenant A's approval -> NOT_FOUND",
    (await codeOf(adminB.approval.decide({ approvalId: pending1.id, decision: "APPROVED" }))) === "NOT_FOUND"
  );
  check("tenant B sees no pending approvals", (await adminB.approval.listPending()).length === 0);
  check("none of that decided anything", (await approvalRow(pending1.id))?.decision === null);

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      admin.approval.decide({ approvalId: pending1.id, decision: "APPROVED", note: "ok" })
    )
  );
  const answers = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  check("5 simultaneous decisions are all answered without an error", answers.length === 5);
  check(
    "exactly one of them claims the decision",
    answers.filter((a) => !a.alreadyDecided).length === 1
  );

  const done1 = await finished(run1.id);
  check("an approved run completes", done1.status === "COMPLETED");
  const out1 = done1.steps[1]?.output as { decision?: string; decidedBy?: string; note?: string } | null;
  check(
    "the approval step records the decision, who decided and the note",
    out1?.decision === "APPROVED" && out1?.decidedBy === "verify-admin" && out1?.note === "ok"
  );
  check("the audit log has exactly one approval.decided row", (await auditCount()) === 1);

  const late = await admin.approval.decide({ approvalId: pending1.id, decision: "REJECTED" });
  check(
    "a late opposite decision changes nothing and reports the existing one",
    late.alreadyDecided && late.decision === "APPROVED" && (await approvalRow(pending1.id))?.decision === "APPROVED"
  );
  check("that late attempt wrote no audit row", (await auditCount()) === 1);
  check("nothing is pending any more", (await admin.approval.listPending()).length === 0);

  // Flow 2: reject.
  const run2 = await admin.run.start({ workflowId: workflow.id });
  const pending2 = await pendingFor(run2.id);
  await admin.approval.decide({ approvalId: pending2.id, decision: "REJECTED", note: "too risky" });
  const done2 = await finished(run2.id);
  check("a rejected run FAILS", done2.status === "FAILED");
  check("the approval step records the reason", done2.steps[1]?.error === "Rejected: too risky");
  check(
    "the step before completed and the step after never ran",
    done2.steps[0]?.status === "COMPLETED" && done2.steps[2]?.status === "PENDING"
  );

  // Flow 3: the wake-up cannot be sent, then a retry recovers the run.
  const run3 = await admin.run.start({ workflowId: workflow.id });
  const pending3 = await pendingFor(run3.id);
  inngest.send = (async () => {
    throw new Error("simulated: Inngest unreachable");
  }) as unknown as typeof inngest.send;
  const failedCode = await codeOf(admin.approval.decide({ approvalId: pending3.id, decision: "APPROVED" }));
  inngest.send = realSend;
  check("a wake-up that cannot be sent reports INTERNAL_SERVER_ERROR", failedCode === "INTERNAL_SERVER_ERROR");
  check("the decision itself was saved", (await approvalRow(pending3.id))?.decision === "APPROVED");
  await sleep(3000);
  check(
    "the run is still waiting because nobody woke it",
    (await admin.run.get({ id: run3.id })).status === "RUNNING"
  );
  const retry = await admin.approval.decide({ approvalId: pending3.id, decision: "APPROVED" });
  check("retrying reports it was already decided", retry.alreadyDecided);
  const done3 = await finished(run3.id);
  check("the retry woke the run and it completed", done3.status === "COMPLETED");
} finally {
  inngest.send = realSend;
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) => tx.tenant.deleteMany({ where: { id } }));
  }
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
