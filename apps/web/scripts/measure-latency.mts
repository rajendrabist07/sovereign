import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@sovereign/db";
import { createCaller } from "../trpc/routers/_app";

const tenantId = `verify-${randomUUID()}`;
const admin = createCaller({
  session: { userId: "measure-script", tenantId, role: "ADMIN" }
});

async function ms(fn: () => Promise<unknown>) {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}

async function median(runs: number, fn: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) samples.push(await ms(fn));
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

const ping = () => withTenant(tenantId, (tx) => tx.$queryRaw`SELECT 1`);

try {
  console.log("first transaction (cold connection):", await ms(ping), "ms");
  await withTenant(tenantId, (tx) =>
    tx.tenant.create({ data: { id: tenantId, name: "Measure", slug: tenantId } })
  );
  console.log("one raw query (about 1 round trip):  ", await median(5, () => prisma.$queryRaw`SELECT 1`), "ms");
  console.log("withTenant SELECT 1 (warm):          ", await median(5, ping), "ms");
  console.log("quota.current (warm):                ", await median(3, () => admin.quota.current()), "ms");
  console.log("run.list (warm):                     ", await median(3, () => admin.run.list({ limit: 8 })), "ms");
  console.log("idling 12 s, then one more transaction...");
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  console.log("withTenant SELECT 1 after idle:      ", await ms(ping), "ms");
} finally {
  await withTenant(tenantId, (tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
  await prisma.$disconnect();
}
