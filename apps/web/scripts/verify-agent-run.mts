import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma, withTenant } from "@sovereign/db";
import { quotaPeriod } from "@sovereign/shared";
import { createCaller } from "../trpc/routers/_app";

// An AGENT step through the real runner and Inngest, with no model configured.
// Valid only while no provider key is set: with one, the step would call a
// real model and spend real tokens, so the script stops instead.

if (process.env.GROQ_API_KEY) {
  console.log("Skipped: GROQ_API_KEY is set, so this check would call a real model.");
  process.exit(0);
}

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

const tenantId = `verify-${randomUUID()}`;
const admin = createCaller({ session: { userId: "verify-admin", tenantId, role: "ADMIN" } });
const { month } = quotaPeriod(new Date());

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

async function finished(runId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await admin.run.get({ id: runId });
    if (run.status === "COMPLETED" || run.status === "FAILED") return run;
    await sleep(1000);
  }
  throw new Error("the run did not finish in time");
}

try {
  await prisma.$connect();
  await withTenant(tenantId, (tx) =>
    tx.tenant.create({ data: { id: tenantId, name: `Verify${tenantId}`, slug: tenantId } })
  );
  const workflow = await admin.workflow.create({
    name: "agent run test",
    definition: {
      steps: [
        { type: "WAIT", name: "before", seconds: 1 },
        { type: "AGENT", name: "Assess lead", task: "Assess the lead", tools: [], allowedHosts: [] },
        { type: "WAIT", name: "after", seconds: 1 }
      ]
    }
  });

  const started = await admin.run.start({ workflowId: workflow.id });
  const run = await finished(started.id);
  const [before, agent, after] = run.steps;

  check("a workflow with an agent step starts and finishes", run.status === "FAILED");
  check("the step before the agent completed", before?.status === "COMPLETED");
  check("the agent step is an AGENT step and it failed", agent?.type === "AGENT" && agent.status === "FAILED");
  check(
    "it failed because no model is configured, not because the runner does not know the step type",
    agent?.error === "No language model is configured yet"
  );
  check("the step after it never ran", after?.status === "PENDING");

  const quota = await withTenant(tenantId, (tx) =>
    tx.quota.findUnique({ where: { tenantId_month: { tenantId, month } } })
  );
  check("no tokens were counted", quota?.tokensUsed === 0);
  check("the run itself still counted against the run limit", quota?.runsUsed === 1);
} finally {
  await withTenant(tenantId, (tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
