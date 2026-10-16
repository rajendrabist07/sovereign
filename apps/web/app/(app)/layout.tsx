import { OrganizationList, OrganizationSwitcher } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { MainNav } from "@/components/main-nav";
import { QuotaMeter } from "@/components/quota-meter";
import { TRPCReactProvider } from "@/trpc/client";

export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const { orgId } = await auth.protect();

  if (!orgId) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="space-y-4 text-center">
          <h1 className="text-xl font-semibold">Choose an organization</h1>
          <p className="max-w-sm text-muted">
            Workflows, runs and usage belong to an organization. Select one or
            create a new one to continue.
          </p>
          <OrganizationList
            hidePersonal
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
        </div>
      </main>
    );
  }

  const switcher = (
    <OrganizationSwitcher
      hidePersonal
      afterCreateOrganizationUrl="/dashboard"
      afterSelectOrganizationUrl="/dashboard"
    />
  );

  return (
    // key={orgId}: switching organization remounts the provider, so the
    // query cache of tenant A can never be shown while viewing tenant B.
    <TRPCReactProvider key={orgId}>
      <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden flex-col gap-6 border-r border-line bg-surface p-4 md:flex">
          {switcher}
          <MainNav className="flex flex-col gap-1" />
          <div className="mt-auto">
            <QuotaMeter />
          </div>
        </aside>
        <div className="min-w-0">
          <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
            {switcher}
            <MainNav className="flex gap-1" />
          </header>
          <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">{children}</main>
        </div>
      </div>
    </TRPCReactProvider>
  );
}
