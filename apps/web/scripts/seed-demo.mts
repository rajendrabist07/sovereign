import { prisma, withTenant } from "@sovereign/db";
import { createCaller } from "../trpc/routers/_app";

// Creates the demo workflows in one tenant, once. Safe to run again.
// Usage: TENANT_ID=org_xxx pnpm run seed-demo
const tenantId = process.env.TENANT_ID;
if (!tenantId) {
  console.error("Set TENANT_ID to the tenant (Clerk organization) id to seed.");
  process.exit(2);
}

const admin = createCaller({
  session: { userId: "seed-script", tenantId, role: "ADMIN" }
});

const DEMO = [
  {
    name: "Lead follow-up (needs approval)",
    definition: {
      steps: [
        {
          type: "HTTP_REQUEST" as const,
          name: "Fetch lead page",
          method: "GET" as const,
          url: "https://example.com"
        },
        {
          type: "MANUAL_APPROVAL" as const,
          name: "Manager sign-off",
          instructions: "Review the fetched page before the follow-up goes out."
        },
        { type: "WAIT" as const, name: "Send follow-up (simulated)", seconds: 2 }
      ]
    }
  }
];

try {
  // Fail clearly instead of with a foreign key error, and show where the data goes.
  const tenant = await withTenant(tenantId, (tx) =>
    tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
  );
  if (!tenant) {
    console.error(`Tenant "${tenantId}" not found. Nothing was created.`);
    process.exit(2);
  }
  console.log(`Seeding into: ${tenant.name} (${tenantId})`);

  const existing = await admin.workflow.list();
  for (const demo of DEMO) {
    const found = existing.find((w) => w.name === demo.name);
    if (found) {
      console.log(`exists:  ${demo.name} (${found.id})`);
      continue;
    }
    const created = await admin.workflow.create(demo);
    console.log(`created: ${demo.name} (${created.id})`);
  }
} finally {
  await prisma.$disconnect();
}
process.exit(0);
