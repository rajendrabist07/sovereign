import { Prisma, PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.RUNTIME_DATABASE_URL,
  // Supabase requires TLS. rejectUnauthorized:false skips CA verification,
  // acceptable for local dev; revisit before production deploy.
  ssl: { rejectUnauthorized: false }
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
 * Measured from a Nepal laptop to Supabase ap-northeast-2:
 * ~150ms per roundtrip, ~1200ms to open a brand-new connection.
 * Prisma's defaults (maxWait 2000ms, timeout 5000ms) leave too little
 * margin on a cold connection, so we set them explicitly.
 */
const TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 15_000
} as const;

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
