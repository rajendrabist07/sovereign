import pg from "pg";

// Checks the permission model of the real database, so that "the runtime role
// cannot read another tenant's data or rewrite the audit log" is a test and
// not a claim. Read-only: its only statements that could change data have
// WHERE false, and it never runs TRUNCATE (it asks the catalog instead).

const ROLE = "app_user";
// Tables with no row level security on purpose. Every other table must have it.
//  - _prisma_migrations: the runtime role has no access to it at all.
const NO_RLS = ["_prisma_migrations"];

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
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
async function codeOf(promise) {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return error.code ?? "ERROR";
  }
}
const priv = async (table, privilege) =>
  (await admin.query("SELECT has_table_privilege($1, $2, $3) AS ok", [ROLE, table, privilege])).rows[0].ok;

try {
  await admin.connect();
  await app.connect();

  const me = (await app.query("SELECT current_user AS u")).rows[0].u;
  check("the runtime connection really is the restricted role", me === ROLE, `connected as ${me}`);

  const role = (
    await admin.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1", [ROLE])
  ).rows[0];
  check(
    "the runtime role is not a superuser and does not bypass row level security",
    role?.rolsuper === false && role?.rolbypassrls === false
  );
  const owned = (
    await admin.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1",
      [ROLE]
    )
  ).rows[0].n;
  check("the runtime role owns no table, so it cannot switch row level security off", owned === 0, `owns ${owned}`);
  check(
    "the runtime role cannot create objects in the public schema",
    (await admin.query("SELECT has_schema_privilege($1, 'public', 'CREATE') AS ok", [ROLE])).rows[0].ok === false
  );

  const tables = (
    await admin.query(
      `SELECT c.relname::text AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`
    )
  ).rows;
  const policies = (
    await admin.query("SELECT tablename::text AS t, cmd::text AS cmd FROM pg_policies WHERE schemaname = 'public'")
  ).rows;
  const tenantScoped = new Set(
    (
      await admin.query(
        `SELECT table_name::text AS t FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'tenantId'`
      )
    ).rows.map((row) => row.t)
  );
  tenantScoped.add("tenants");

  for (const name of [...tenantScoped].sort()) {
    const table = tables.find((candidate) => candidate.name === name);
    const count = policies.filter((policy) => policy.t === name).length;
    check(
      `${name}: row level security is on, forced, and has a policy`,
      Boolean(table?.rls && table.forced && count > 0),
      JSON.stringify({ rls: table?.rls, forced: table?.forced, policies: count })
    );
  }
  const withoutRls = tables.filter((table) => !table.rls).map((table) => table.name);
  check(
    "the only tables without row level security are the documented exceptions",
    sameSet(withoutRls, NO_RLS),
    `without row level security: ${withoutRls.sort().join(", ")}`
  );

  check(
    "audit_log: the runtime role can insert and read",
    (await priv("audit_log", "INSERT")) && (await priv("audit_log", "SELECT"))
  );
  const stillGranted = [];
  for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"]) {
    if (await priv("audit_log", privilege)) stillGranted.push(privilege);
  }
  check("audit_log: the runtime role cannot update, delete or truncate", stillGranted.length === 0, `still granted: ${stillGranted.join(", ")}`);
  const auditCommands = policies.filter((policy) => policy.t === "audit_log").map((policy) => policy.cmd);
  check(
    "audit_log has policies for SELECT and INSERT only",
    sameSet(auditCommands, ["SELECT", "INSERT"]),
    `commands: ${auditCommands.join(", ")}`
  );

  const migrationAccess = [];
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
    if (await priv("_prisma_migrations", privilege)) migrationAccess.push(privilege);
  }
  check(
    "_prisma_migrations: the runtime role has no access at all",
    migrationAccess.length === 0,
    `granted: ${migrationAccess.join(", ")}`
  );

  check(
    "the database itself refuses an UPDATE on audit_log",
    (await codeOf(app.query("UPDATE audit_log SET action = action WHERE false"))) === "42501"
  );
  check(
    "the database itself refuses a DELETE on audit_log",
    (await codeOf(app.query("DELETE FROM audit_log WHERE false"))) === "42501"
  );
  check(
    "the migration history cannot be read by the runtime role",
    (await codeOf(app.query("SELECT 1 FROM _prisma_migrations LIMIT 1"))) === "42501"
  );

  const real = (await admin.query("SELECT count(*)::int AS n FROM workflows")).rows[0].n;
  if (real === 0) {
    out("SKIP  row level security behaviour: there are no workflows to hide");
  } else {
    const seen = (await app.query("SELECT count(*)::int AS n FROM workflows")).rows[0].n;
    check(`with no organisation set the runtime role sees none of the ${real} workflows`, seen === 0, `saw ${seen}`);
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.tenant_id', $1, true)", ["verify-permissions-no-such-tenant"]);
      const other = (await app.query("SELECT count(*)::int AS n FROM workflows")).rows[0].n;
      check("with an organisation that owns nothing it sees none of them either", other === 0, `saw ${other}`);
    } finally {
      await app.query("ROLLBACK");
    }
  }
} catch (error) {
  process.stderr.write(`failed: ${error.message}\n`);
  failures++;
} finally {
  await admin.end().catch(() => undefined);
  await app.end().catch(() => undefined);
}

out(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
