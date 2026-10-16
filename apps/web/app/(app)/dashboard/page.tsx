import { RecentRuns } from "@/components/recent-runs";

export const metadata = { title: "Dashboard | Sovereign" };

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted">What your workflows have been doing lately.</p>
      </header>
      <section aria-labelledby="recent-runs">
        <h2 id="recent-runs" className="mb-2 font-medium">
          Recent runs
        </h2>
        <RecentRuns />
      </section>
    </div>
  );
}
