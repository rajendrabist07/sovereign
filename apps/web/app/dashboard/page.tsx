import { OrganizationSwitcher } from "@clerk/nextjs";
import { ensureUserAndTenant } from "@/lib/auth/ensure-tenant";

export default async function DashboardPage() {
  const result = await ensureUserAndTenant();

  if (result.needsOrganization) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
        <p>Create or join an organization to continue.</p>
        <OrganizationSwitcher hidePersonal />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-24">
      <h1 className="text-2xl font-semibold">Welcome, {result.user.email}</h1>
      <p className="text-muted-foreground">
        Tenant: {result.tenant.name} ({result.tenant.slug}) — role:{" "}
        {result.role}
      </p>
      <OrganizationSwitcher hidePersonal />
    </main>
  );
}
