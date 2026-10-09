import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@sovereign/db";
import type { Role } from "@sovereign/shared";
import { createCaller } from "../trpc/routers/_app";

const tenantA = `verify-${randomUUID()}`;
const tenantB = `verify-${randomUUID()}`;

const as = (tenantId: string, role: Role) =>
  createCaller({ session: { userId: "verify-user", tenantId, role } });

const definition = {
  steps: [{ type: "WAIT" as const, name: "pause", seconds: 5 }]
};

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

// `instanceof TRPCError` is false here because two copies of the class
// are loaded (script vs router). Duck-typing on name + code works either way.
function isTrpcError(error: unknown): error is { name: string; code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "TRPCError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return isTrpcError(error) ? error.code : "UNEXPECTED_ERROR";
  }
}

try {
  // Warm-up: open the DB connection now so the first real transaction
  // doesn't pay the ~1.2s cold-connect cost inside its maxWait window.
  await prisma.$connect();

  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) =>
      tx.tenant.create({ data: { id, name: `Verify${id}`, slug: id } })
    );
  }

  const adminA = as(tenantA, "ADMIN");
  const adminB = as(tenantB, "ADMIN");
  const created = await adminA.workflow.create({ name: "A workflow", definition });

  check(
    "VIEWER cannot create -> FORBIDDEN",
    (await codeOf(as(tenantA, "VIEWER").workflow.create({ name: "x", definition }))) === "FORBIDDEN"
  );
  check(
    "MEMBER cannot create -> FORBIDDEN",
    (await codeOf(as(tenantA, "MEMBER").workflow.create({ name: "x", definition }))) === "FORBIDDEN"
  );
  check(
    "no session -> UNAUTHORIZED",
    (await codeOf(createCaller({ session: null, reason: "UNAUTHENTICATED" }).workflow.list())) === "UNAUTHORIZED"
  );
  check(
    "no organization -> PRECONDITION_FAILED",
    (await codeOf(createCaller({ session: null, reason: "NO_ORGANIZATION" }).workflow.list())) === "PRECONDITION_FAILED"
  );
  check(
    "empty name rejected -> BAD_REQUEST",
    (await codeOf(adminA.workflow.create({ name: "", definition }))) === "BAD_REQUEST"
  );
  check(
    "VIEWER can list own tenant's workflows",
    (await as(tenantA, "VIEWER").workflow.list()).length === 1
  );
  check(
    "tenant B sees zero of tenant A's workflows",
    (await adminB.workflow.list()).length === 0
  );
  check(
    "tenant B get(A's id) -> NOT_FOUND",
    (await codeOf(adminB.workflow.get({ id: created.id }))) === "NOT_FOUND"
  );
  check(
    "tenant B update(A's id) -> NOT_FOUND",
    (await codeOf(adminB.workflow.update({ id: created.id, name: "hijack", definition }))) === "NOT_FOUND"
  );
  check(
    "tenant B delete(A's id) -> NOT_FOUND",
    (await codeOf(adminB.workflow.delete({ id: created.id }))) === "NOT_FOUND"
  );

  const afterAttacks = await adminA.workflow.get({ id: created.id });
  check(
    "A's workflow survived B's update/delete attempts, unchanged",
    afterAttacks.name === "A workflow"
  );

  await adminA.workflow.delete({ id: created.id });
  check(
    "ADMIN can delete own workflow",
    (await adminA.workflow.list()).length === 0
  );
} finally {
  for (const id of [tenantA, tenantB]) {
    await withTenant(id, (tx) => tx.tenant.deleteMany({ where: { id } }));
  }
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);