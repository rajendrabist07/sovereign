import { auth } from "@clerk/nextjs/server";
import { ensureUserAndTenant } from "@/lib/auth/ensure-tenant";
import type { Context } from "./init";

export async function createTRPCContext(): Promise<Context> {
  const { userId } = await auth();
  if (!userId) return { session: null, reason: "UNAUTHENTICATED" };

  const result = await ensureUserAndTenant();
  if (result.needsOrganization) {
    return { session: null, reason: "NO_ORGANIZATION" };
  }

  return {
    session: {
      userId: result.user.id,
      tenantId: result.tenant.id,
      role: result.role
    }
  };
}
