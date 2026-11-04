import pg from "pg";

// Removes test tenants (id starts with "verify-") that a crashed verify script
// left behind. Dry run unless --yes. Only tenants older than --min-age-minutes
// (default 10) are touched, so a test that is running right now is safe.
const MAX_DELETE = 200;
const args = process.argv.slice(2);
const confirm = args.includes("--yes");
const ageArg = args.find((arg) => arg.startsWith("--min-age-minutes="));
const minAge = ageArg === undefined ? 10 : Number(ageArg.split("=")[1]);

const say = (text) => process.stdout.write(`${text}\n`);
const fail = (text, code) => {
  process.stderr.write(`${text}\n`);
  process.exit(code);
};

if (!Number.isInteger(minAge) || minAge < 0) fail("--min-age-minutes must be a whole number, 0 or more", 2);
const url = process.env.DIRECT_URL;
const ca = process.env.DB_SSL_CA?.replace(/\\n/g, "\n");
if (!url || !ca) fail("DIRECT_URL and DB_SSL_CA must be set (they are read from the repo .env)", 2);

const client = new pg.Client({ connectionString: url, ssl: { ca, rejectUnauthorized: true } });
try {
  await client.connect();
  const result = await client.query(
    `SELECT id, "createdAt" FROM tenants
     WHERE left(id, 7) = 'verify-'
     AND "createdAt" < now() - make_interval(mins => $1::int)
     ORDER BY "createdAt"`,
    [minAge]
  );
  // A second, independent guard: never act on anything but a test tenant.
  const found = result.rows.filter((row) => row.id.startsWith("verify-"));

  say(`stale test tenants (older than ${minAge} min): ${found.length}`);
  for (const row of found.slice(0, 20)) say(`  ${row.id}  ${row.createdAt.toISOString()}`);

  if (found.length > MAX_DELETE) fail(`Refusing to touch more than ${MAX_DELETE} tenants. Look at the list first.`, 1);
  if (!confirm) {
    say("dry run: nothing deleted. Add --yes to delete them.");
  } else if (found.length > 0) {
    const gone = await client.query("DELETE FROM tenants WHERE id = ANY($1::text[]) RETURNING id", [
      found.map((row) => row.id)
    ]);
    say(`deleted: ${gone.rowCount}`);
  } else {
    say("deleted: 0");
  }
} catch (error) {
  process.stderr.write(`failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
