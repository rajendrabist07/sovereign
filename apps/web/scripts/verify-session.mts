import type { Role } from "@sovereign/shared";
import { createCaller } from "../trpc/routers/_app";
import { codeOf, createChecker } from "./lib";

const { check, finish } = createChecker();

const as = (role: Role) =>
  createCaller({
    session: { userId: "verify-user", tenantId: "verify-session-no-db", role }
  });

for (const role of ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const) {
  const me = await as(role).me();
  check(`me returns the ${role} role`, me.role === role);
}

check(
  "me needs a session -> UNAUTHORIZED",
  (await codeOf(createCaller({ session: null, reason: "UNAUTHENTICATED" }).me())) === "UNAUTHORIZED"
);
check(
  "me needs an organization -> PRECONDITION_FAILED",
  (await codeOf(createCaller({ session: null, reason: "NO_ORGANIZATION" }).me())) === "PRECONDITION_FAILED"
);

// A tenant transaction costs at least 4 round trips to a remote database,
// so a DB-free procedure is far under this. (It cannot fail for a DB-free
// procedure, but it only proves the point when the database is remote.)
const started = performance.now();
await as("VIEWER").me();
const elapsed = performance.now() - started;
check(`me answers without a database round trip (${Math.round(elapsed)} ms)`, elapsed < 100);

finish();
