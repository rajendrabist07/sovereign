import { randomUUID } from "node:crypto";
import pg from "pg";

// Row level security on the users table: a person can only touch their own
// row. Every behaviour check runs in a transaction that is rolled back, so it
// changes nothing even while the protection is missing. Test rows use the
// prefix verify_perm_; they are removed at the end, and stale ones at the start.

const ca = process.env.DB_SSL_CA?.replace(/\\n/g, "\n");
const adminUrl = process.env.DIRECT_URL;
const runtimeUrl = process.env.RUNTIME_DATABASE_URL;
if (!ca || !adminUrl || !runtimeUrl) {
  process.stderr.write("DB_SSL_CA, DIRECT_URL and RUNTIME_DATABASE_URL must be set (read from the repo .env)\n");
  process.exit(2);
}
const ssl = { ca, rejectUnauthorized: true };
const admin = new pg.Client({ connectionString: adminUrl, ssl });
const app = new pg.Client({ connectionString: runtimeUrl, ssl });

let failures = 0;
const out = (text) => process.stdout.write(`${text}\n`);
function check(label, ok, detail) {
  out(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures++;
    if (detail) out(`      ${detail}`);
  }
}
async function codeOf(promise) {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return error.code ?? "ERROR";
  }
}
const person = () => {
  const clerkId = `verify_perm_${randomUUID()}`;
  return { clerkId, email: `${clerkId}@example.invalid` };
};
const [a, b, c, d] = [person(), person(), person(), person()];
const insertSql = 'INSERT INTO users (id, "clerkId", email) VALUES ($1, $2, $3)';

// Runs fn as the runtime role with a person set (or none) and always rolls back.
async function asPerson(clerkId, fn) {
  await app.query("BEGIN");
  try {
    if (clerkId !== null) await app.query("SELECT set_config('app.clerk_id', $1, true)", [clerkId]);
    return await fn();
  } finally {
    await app.query("ROLLBACK");
  }
}

try {
  await admin.connect();
  await app.connect();

  await admin.query(
    `DELETE FROM users WHERE left("clerkId", 12) = 'verify_perm_' AND "createdAt" < now() - make_interval(mins => 10)`
  );
  for (const user of [a, b]) await admin.query(insertSql, [randomUUID(), user.clerkId, user.email]);

  const table = (
    await admin.query(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'users'`
    )
  ).rows[0];
  const policyCount = (
    await admin.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'")
  ).rows[0].n;
  check(
    "users: row level security is on, forced, and has a policy",
    Boolean(table?.rls && table.forced && policyCount > 0),
    JSON.stringify({ rls: table?.rls, forced: table?.forced, policies: policyCount })
  );

  const ids = [a.clerkId, b.clerkId];
  const pick = `SELECT "clerkId" FROM users WHERE "clerkId" = ANY($1)`;

  const none = await asPerson(null, async () => (await app.query(pick, [ids])).rows);
  check("with no person set the runtime role sees none of the users", none.length === 0, `saw ${none.length}`);

  const asA = await asPerson(a.clerkId, async () => {
    const seen = (await app.query(pick, [ids])).rows.map((row) => row.clerkId);
    const updated = await app.query('UPDATE users SET email = $1 WHERE "clerkId" = $2', [
      `${b.clerkId}.changed@example.invalid`,
      b.clerkId
    ]);
    const deleted = await app.query('DELETE FROM users WHERE "clerkId" = $1', [b.clerkId]);
    return { seen, updated: updated.rowCount, deleted: deleted.rowCount };
  });
  check(
    "a person sees only their own row",
    asA.seen.length === 1 && asA.seen[0] === a.clerkId,
    `saw ${asA.seen.length} rows`
  );
  check("a person cannot update someone else's row", asA.updated === 0, `updated ${asA.updated} rows`);
  check("a person cannot delete someone else's row", asA.deleted === 0, `deleted ${asA.deleted} rows`);

  const forOther = await asPerson(a.clerkId, () =>
    codeOf(app.query(insertSql, [randomUUID(), c.clerkId, c.email]))
  );
  check("a person cannot create a row for someone else", forOther === "42501", `result: ${forOther}`);

  const fresh = await asPerson(d.clerkId, () => codeOf(app.query(insertSql, [randomUUID(), d.clerkId, d.email])));
  check("a new person can create their own row", fresh === "OK", `result: ${fresh}`);

  const again = await asPerson(a.clerkId, async () =>
    (
      await app.query(
        `INSERT INTO users (id, "clerkId", email) VALUES ($1, $2, $3)
         ON CONFLICT ("clerkId") DO UPDATE SET email = EXCLUDED.email RETURNING id`,
        [randomUUID(), a.clerkId, a.email]
      )
    ).rowCount
  );
  check("signing in again updates your own row", again === 1, `rows: ${again}`);
} catch (error) {
  process.stderr.write(`failed: ${error.message}\n`);
  failures++;
} finally {
  await admin
    .query('DELETE FROM users WHERE "clerkId" = ANY($1)', [[a.clerkId, b.clerkId, c.clerkId, d.clerkId]])
    .catch(() => undefined);
  await admin.end().catch(() => undefined);
  await app.end().catch(() => undefined);
}

out(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
