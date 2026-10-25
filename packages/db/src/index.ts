import { Prisma, PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.RUNTIME_DATABASE_URL,
  // Supabase requires TLS. rejectUnauthorized:false skips CA verification,
  // acceptable for local dev; revisit before production deploy.
  ssl: { rejectUnauthorized: false },
  // Keep connections open between requests: a new one costs ~1.2 s
  // (TCP + TLS + auth at ~150 ms per round trip, Nepal to Seoul).
  idleTimeoutMillis: 300_000
});

// Reuse one client across hot-reloads in dev — Next.js reloads modules
// on every file save, and without this each reload would open a new
// pool of DB connections until Supabase's connection limit is hit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Reads a positive integer from the environment. A typo like "5s" throws
 * at startup instead of silently falling back to the default, because a
 * misconfigured timeout that nobody notices is worse than a crash.
 */
function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (milliseconds), got "${raw}"`);
  }
  return value;
}

/**
 * Measured from a Nepal laptop to Supabase ap-northeast-2:
 * ~150ms per roundtrip, ~1200-1600ms to open a brand-new connection.
 * Prisma's defaults (maxWait 2000ms, timeout 5000ms) leave too little
 * margin on a cold connection, so we set them explicitly.
 *
 * The defaults suit that slow local link. In production, where the app
 * runs next to the database, set DB_TX_MAX_WAIT_MS / DB_TX_TIMEOUT_MS
 * lower so pool exhaustion fails fast instead of queueing for 10 s.
 */
const TRANSACTION_OPTIONS = {
  maxWait: positiveIntFromEnv("DB_TX_MAX_WAIT_MS", 10_000),
  timeout: positiveIntFromEnv("DB_TX_TIMEOUT_MS", 15_000)
};

/**
 * Runs `fn` inside a transaction with Postgres' session-local
 * app.tenant_id set; RLS policies read this to decide which rows are
 * visible. set_config() is used instead of `SET LOCAL ... = '${id}'`
 * because it accepts a bound parameter, so no string interpolation of
 * untrusted input into SQL.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }, TRANSACTION_OPTIONS);
}

/** The transaction client handed to code running inside withTenant(). */
export type TenantTx = Prisma.TransactionClient;
