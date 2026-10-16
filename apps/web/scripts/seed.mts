import { prisma, withTenant } from "@sovereign/db";
import type { WorkflowDefinition } from "@sovereign/shared";
import { createCaller } from "../trpc/routers/_app";
import { requireDevStack } from "./lib";

const tenantId = process.env.SEED_TENANT_ID;
if (!tenantId || tenantId.startsWith("verify-")) {
  console.error("Set SEED_TENANT_ID to your Clerk organization id, e.g. SEED_TENANT_ID=org_123 pnpm run seed");
  process.exit(1);
}

await requireDevStack();

const exists = await withTenant(tenantId, (tx) =>
  tx.tenant.findUnique({ where: { id: tenantId } })
);
if (!exists) {
  console.error(`No tenant ${tenantId}. Open /dashboard once while signed in, then retry.`);
  process.exit(1);
}

const admin = createCaller({
  session: { userId: "seed-script", tenantId, role: "ADMIN" }
});

const samples: Array<{ name: string; definition: WorkflowDefinition }> = [
  {
    name: "Health check",
    definition: {
      steps: [
        { type: "HTTP_REQUEST", name: "Ping example.com", method: "GET", url: "https://example.com/" },
        { type: "WAIT", name: "Cool down", seconds: 3 }
      ]
    }
  },
  {
    name: "Broken endpoint",
    definition: {
      steps: [
        { type: "HTTP_REQUEST", name: "Call missing page", method: "GET", url: "https://httpbin.org/status/404" },
        { type: "WAIT", name: "Never reached", seconds: 1 }
      ]
    }
  },
  {
    name: "Slow job",
    definition: {
      steps: [
        { type: "WAIT", name: "Warm up", seconds: 10 },
        { type: "HTTP_REQUEST", name: "Ping example.com", method: "GET", url: "https://example.com/" },
        { type: "WAIT", name: "Settle", seconds: 10 }
      ]
    }
  }
];

try {
  const existing = await admin.workflow.list();
  for (const sample of samples) {
    const found = existing.find((w) => w.name === sample.name);
    const workflow =
      found ?? (await admin.workflow.create({ name: sample.name, definition: sample.definition }));
    const run = await admin.run.start({ workflowId: workflow.id });
    console.log(`${found ? "reused" : "created"} "${sample.name}", started run ${run.id}`);
    // Stagger so the runs get visibly different timestamps.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
} finally {
  await prisma.$disconnect();
}
