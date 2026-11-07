import { randomUUID } from "node:crypto";
import { prisma, withUser } from "@sovereign/db";

// The contract of withUser. It must hold both before and after row level
// security is switched on for the users table, so it only checks what the
// caller can rely on in either case.

const clerkA = `verify_clerk_${randomUUID()}`;
const clerkB = `verify_clerk_${randomUUID()}`;
const emailOf = (clerkId: string, version: number) => `${clerkId}.${version}@example.invalid`;

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

const currentClerkId = (tx: { $queryRaw: typeof prisma.$queryRaw }) =>
  tx.$queryRaw<Array<{ v: string | null }>>`SELECT current_setting('app.clerk_id', true) AS v`;

const upsertUser = (clerkId: string, version: number) =>
  withUser(clerkId, (tx) =>
    tx.user.upsert({
      where: { clerkId },
      update: { email: emailOf(clerkId, version) },
      create: { clerkId, email: emailOf(clerkId, version) }
    })
  );

try {
  await prisma.$connect();

  const inside = await withUser(clerkA, async (tx) => (await currentClerkId(tx))[0]?.v);
  check("inside withUser the caller's Clerk id is set for the transaction", inside === clerkA);

  const insideAgain = await withUser(clerkB, async (tx) => (await currentClerkId(tx))[0]?.v);
  check("the next call sets its own id, not the previous one", insideAgain === clerkB);

  const outside = (await currentClerkId(prisma))[0]?.v;
  check("outside withUser no Clerk id is set: it does not leak out of the transaction", !outside);

  const first = await upsertUser(clerkA, 1);
  check("the first sign-in creates the user", first.clerkId === clerkA && first.email === emailOf(clerkA, 1));
  const second = await upsertUser(clerkA, 2);
  check("the next sign-in updates the same row", second.id === first.id && second.email === emailOf(clerkA, 2));
  const other = await upsertUser(clerkB, 1);
  check("a different person gets a different row", other.id !== first.id && other.clerkId === clerkB);

  const rows = await withUser(clerkA, (tx) => tx.user.count({ where: { clerkId: clerkA } }));
  check("a person can read their own row", rows === 1);

  let failed = false;
  try {
    await withUser(clerkA, async () => {
      throw new Error("boom");
    });
  } catch {
    failed = true;
  }
  check("an error inside withUser is passed on", failed);
} finally {
  for (const clerkId of [clerkA, clerkB]) {
    await withUser(clerkId, (tx) => tx.user.deleteMany({ where: { clerkId } })).catch(() => undefined);
  }
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
