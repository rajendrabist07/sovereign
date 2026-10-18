import Link from "next/link";
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
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="recent-runs" className="font-medium">
            Recent runs
          </h2>
          <Link href="/runs" className="text-sm text-muted hover:text-ink">
            View all runs
          </Link>
        </div>
        <RecentRuns />
      </section>
    </div>
  );
}
