import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@sovereign/db";
import { createCaller } from "../trpc/routers/_app";

const tenantA = `verify-${randomUUID()}`;
const tenantB = `verify-${randomUUID()}`;

const as = (tenantId: string, role: "VIEWER" | "MEMBER" | "ADMIN") =>
  createCaller({ session: { userId: "verify-user", tenantId, role } });

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

const admin = as(tenantA, "ADMIN");

async function waitForTerminal(runId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await admin.run.get({ id: runId });
    if (run.status === "COMPLETED" || run.status === "FAILED") return run;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`run ${runId} did not finish within ${timeoutMs}ms`);
}

const okDefinition = {
  steps: [
    { type: "WAIT" as const, name: "pause", seconds: 2 },
    { type: "HTTP_REQUEST" as const, name: "ping", method: "GET" as const, url: "https://example.com/" }
  ]
};
const failDefinition = {
  steps: [
    { type: "HTTP_REQUEST" as const, name: "missing", method: "GET" as const, url: "https://httpbin.org/status/404" },
    { type: "WAIT" as const, name: "never-runs", seconds: 1 }
  ]
};
const unsafeDefinition = {
  steps: [
    { type: "HTTP_REQUEST" as const, name: "local", method: "GET" as const, url: "https://localhost/" }
  ]
};

async function requireService(name: string, url: string, hint: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(name + " is not reachable at " + url + ". " + hint);
    process.exit(2);
  }
}

await requireService("Inngest dev server", "http://localhost:8288", "Start it in a separate terminal (npx inngest-cli dev).");
await requireService("Next.js app", "http://localhost:3000/api/inngest", "Run pnpm dev from the repo root.");

try {
  await prisma.$connect();
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) =>
      tx.tenant.create({ data: { id, name: `Verify ${id}`, slug: id } })
    );
  }

  const okFlow = await admin.workflow.create({ name: "ok-flow", definition: okDefinition });
  const failFlow = await admin.workflow.create({ name: "fail-flow", definition: failDefinition });
  const unsafeFlow = await admin.workflow.create({ name: "unsafe-flow", definition: unsafeDefinition });

  check(
    "VIEWER cannot start a run -> FORBIDDEN",
    (await codeOf(as(tenantA, "VIEWER").run.start({ workflowId: okFlow.id }))) === "FORBIDDEN"
  );

  const okStarted = await as(tenantA, "MEMBER").run.start({ workflowId: okFlow.id });
  const failStarted = await admin.run.start({ workflowId: failFlow.id });
  const unsafeStarted = await admin.run.start({ workflowId: unsafeFlow.id });

  const snapshot = await admin.run.get({ id: okStarted.id });
  check(
    "run starts PENDING with one step row per definition step",
    okStarted.status === "PENDING" && snapshot.steps.length === 2
  );

  const okRun = await waitForTerminal(okStarted.id);
  check("ok-flow run COMPLETED", okRun.status === "COMPLETED");
  const waitOutput = okRun.steps[0]?.output as { waitedSeconds?: number } | null;
  const httpOutput = okRun.steps[1]?.output as { status?: number } | null;
  check(
    "ok-flow steps COMPLETED with outputs (waited 2s, HTTP 200)",
    okRun.steps.every((s) => s.status === "COMPLETED") &&
    waitOutput?.waitedSeconds === 2 &&
    httpOutput?.status === 200
  );
  check("ok-flow has startedAt and finishedAt", okRun.startedAt !== null && okRun.finishedAt !== null);

  const failRun = await waitForTerminal(failStarted.id);
  check("fail-flow run FAILED", failRun.status === "FAILED");
  check(
    "fail-flow failing step recorded its error (404)",
    failRun.steps[0]?.status === "FAILED" && /404/.test(failRun.steps[0]?.error ?? "")
  );
  check("fail-flow: step after the failure never ran", failRun.steps[1]?.status === "PENDING");

  const unsafeRun = await waitForTerminal(unsafeStarted.id);
  check(
    "unsafe-flow blocked by SSRF guard (FAILED, private address)",
    unsafeRun.status === "FAILED" && /Private/.test(unsafeRun.steps[0]?.error ?? "")
  );

  check(
    "tenant B cannot read tenant A's run -> NOT_FOUND",
    (await codeOf(as(tenantB, "ADMIN").run.get({ id: okStarted.id }))) === "NOT_FOUND"
  );

  const audit = await withTenant(tenantA, (tx) =>
    tx.auditLog.findMany({ where: { action: "run.requested" } })
  );
  check("each started run wrote a run.requested audit row", audit.length === 3);

  if (failures > 0) {
    console.log("\nDebug (steps of each run):");
    for (const run of [okRun, failRun, unsafeRun]) {
      console.log(run.status, run.steps.map((s) => `${s.stepIndex}:${s.status}${s.error ? ` (${s.error})` : ""}`));
    }
  }
} finally {
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) => tx.tenant.deleteMany({ where: { id } }));
  }
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
