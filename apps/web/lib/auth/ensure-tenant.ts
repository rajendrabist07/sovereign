import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { prisma, withTenant, type TenantTx } from "@sovereign/db";
import type { Role } from "@sovereign/shared";
import { createSyncCache, syncKey } from "./sync-cache";

export type ResolvedSession = { userId: string; tenantId: string; role: Role };

export type Resolution =
  | { needsOrganization: true }
  | { needsOrganization: false; session: ResolvedSession };

// Per process and best effort: a cold serverless instance just syncs again.
const synced = createSyncCache<ResolvedSession>({
  ttlMs: 5 * 60_000,
  maxEntries: 500
});

function upsertMembership(tx: TenantTx, userId: string, tenantId: string, role: Role) {
  return tx.membership.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    update: { role },
    create: { userId, tenantId, role }
  });
}

/**
 * Mirrors the signed-in Clerk user, their active Clerk Organization and
 * their role into our users / tenants / memberships tables. Clerk's org_id
 * IS our tenant_id, so we never have to "discover" the tenant from a
 * tenant-scoped table (the RLS chicken-and-egg problem).
 */
export async function ensureUserAndTenant(): Promise<Resolution> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    throw new Error("ensureUserAndTenant called without a signed-in user");
  }
  if (!orgId) return { needsOrganization: true };

  const key = syncKey(userId, orgId, orgRole);
  const hit = synced.get(key);
  if (hit) return { needsOrganization: false, session: hit };

  const clerkUser = await currentUser();
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ?? `${userId}@unknown.invalid`;

  // users has no RLS (one person can belong to many tenants).
  const user = await prisma.user.upsert({
    where: { clerkId: userId },
    update: { email },
    create: { clerkId: userId, email }
  });

  const role: Role = orgRole === "org:admin" ? "ADMIN" : "MEMBER";

  // One transaction when the tenant already exists (the common case).
  const mirrored = await withTenant(orgId, async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: orgId },
      select: { id: true }
    });
    if (!tenant) return false;
    await upsertMembership(tx, user.id, orgId, role);
    return true;
  });

  if (!mirrored) {
    // The network call to Clerk happens OUTSIDE any DB transaction.
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: orgId
    });
    // upsert (not create): two simultaneous first requests must not crash
    // on the unique constraint.
    await withTenant(orgId, async (tx) => {
      await tx.tenant.upsert({
        where: { id: orgId },
        update: {},
        create: { id: orgId, name: org.name, slug: org.slug ?? orgId }
      });
      await upsertMembership(tx, user.id, orgId, role);
    });
  }

  const session = { userId: user.id, tenantId: orgId, role };
  synced.set(key, session);
  return { needsOrganization: false, session };
}
