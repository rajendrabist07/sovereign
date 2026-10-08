import pg from "pg";
import "dotenv/config";
import { randomUUID } from "node:crypto";


const client = new pg.Client({
    connectionString: `postgresql://app_user:${process.env.APP_USER_PASSWORD}@db.yshmnlqgcnxkuhvopfrh.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false }
});

console.log("DEBUG host/user:", `app_user@db.yshmnlqgcnxkuhvopfrh.supabase.co`, "password length:", process.env.APP_USER_PASSWORD?.length);
await client.connect();

// Cleanup from any previous run (ignore errors if nothing exists yet)
await client.query(
    "DELETE FROM tenants WHERE slug IN ('rls-test-a', 'rls-test-b')"
);

const tenantA = randomUUID();
const tenantB = randomUUID();

// --- Setup: create two tenants + one workflow each ---
// NOTE: SET LOCAL only applies inside a transaction — that's why
// everything here is wrapped in BEGIN/COMMIT.

await client.query("BEGIN");
await client.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
await client.query(
    "INSERT INTO tenants (id, name, slug) VALUES ($1, 'RLS Test A', 'rls-test-a')",
    [tenantA]
);
await client.query(
    `INSERT INTO workflows (id, "tenantId", name, definition, "createdBy")
   VALUES ($1, $2, 'Workflow A', '{}', 'test')`,
    [randomUUID(), tenantA]
);
await client.query("COMMIT");

await client.query("BEGIN");
await client.query(`SET LOCAL app.tenant_id = '${tenantB}'`);
await client.query(
    "INSERT INTO tenants (id, name, slug) VALUES ($1, 'RLS Test B', 'rls-test-b')",
    [tenantB]
);
await client.query(
    `INSERT INTO workflows (id, "tenantId", name, definition, "createdBy")
   VALUES ($1, $2, 'Workflow B', '{}', 'test')`,
    [randomUUID(), tenantB]
);
await client.query("COMMIT");

console.log("Setup done: 2 tenants, 1 workflow each.\n");

// --- Test 1: NO tenant context set at all → must see ZERO rows ---
await client.query("BEGIN");
const noContext = await client.query("SELECT name FROM workflows");
console.log(
    "Test 1 (no context set) — rows visible:",
    noContext.rows.length,
    noContext.rows.length === 0 ? "✅ PASS (fail-closed)" : "❌ FAIL — LEAK!"
);
await client.query("COMMIT");

// --- Test 2: Tenant A context → must see ONLY Workflow A ---
await client.query("BEGIN");
await client.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
const asA = await client.query("SELECT name FROM workflows");
console.log(
    "Test 2 (as Tenant A) — rows visible:",
    asA.rows.map((r) => r.name),
    asA.rows.length === 1 && asA.rows[0].name === "Workflow A"
        ? "✅ PASS"
        : "❌ FAIL"
);
await client.query("COMMIT");

// --- Test 3: Tenant B context → must see ONLY Workflow B ---
await client.query("BEGIN");
await client.query(`SET LOCAL app.tenant_id = '${tenantB}'`);
const asB = await client.query("SELECT name FROM workflows");
console.log(
    "Test 3 (as Tenant B) — rows visible:",
    asB.rows.map((r) => r.name),
    asB.rows.length === 1 && asB.rows[0].name === "Workflow B"
        ? "✅ PASS"
        : "❌ FAIL"
);
await client.query("COMMIT");

// --- Cleanup ---
await client.query("BEGIN");
await client.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
await client.query("DELETE FROM tenants WHERE id = $1", [tenantA]);
await client.query("COMMIT");

await client.query("BEGIN");
await client.query(`SET LOCAL app.tenant_id = '${tenantB}'`);
await client.query("DELETE FROM tenants WHERE id = $1", [tenantB]);
await client.query("COMMIT");

console.log("\nCleanup done.");
await client.end();