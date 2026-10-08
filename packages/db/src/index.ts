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
  });
}
