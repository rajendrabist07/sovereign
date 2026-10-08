import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { prisma, withTenant } from "@sovereign/db";

/**
 * Call at the top of any protected page/route. Mirrors the signed-in
 * Clerk user, their active Clerk Organization, and their role into our
 * own users / tenants / memberships tables (first time only).
 *
 * Clerk's org_id IS our tenant_id, so we never have to "discover" the
 * tenant from a tenant-scoped table (the RLS chicken-and-egg problem).
 */
export async function ensureUserAndTenant() {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    throw new Error("ensureUserAndTenant called without a signed-in user");
  }
  if (!orgId) {
    return { needsOrganization: true as const };
  }

  const clerkUser = await currentUser();
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ?? `${userId}@unknown.invalid`;

  // users has no RLS (one person can belong to many tenants).
  const user = await prisma.user.upsert({
    where: { clerkId: userId },
    update: { email },
    create: { clerkId: userId, email }
  });

  const role = orgRole === "org:admin" ? "ADMIN" : "MEMBER";

  let tenant = await withTenant(orgId, (tx) =>
    tx.tenant.findUnique({ where: { id: orgId } })
  );

  if (!tenant) {
    // Network call to Clerk happens OUTSIDE any DB transaction, so we
    // never hold a transaction open while waiting on another service.
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: orgId
    });

    // upsert (not create): two simultaneous first requests must not
    // crash on the unique constraint.
    tenant = await withTenant(orgId, (tx) =>
      tx.tenant.upsert({
        where: { id: orgId },
        update: {},
        create: { id: orgId, name: org.name, slug: org.slug ?? orgId }
      })
    );
  }

  const membership = await withTenant(orgId, (tx) =>
    tx.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: orgId } },
      update: { role },
      create: { userId: user.id, tenantId: orgId, role }
    })
  );

  return {
    needsOrganization: false as const,
    user,
    tenant,
    role: membership.role
  };
}
