import Link from "next/link";

const LIVE = [
  {
    title: "Tenant isolation in the database",
    body: "Every row belongs to a tenant and Postgres row-level security enforces it, so a forgotten WHERE clause cannot leak another tenant's data."
  },
  {
    title: "Role-based access",
    body: "Owner, Admin, Member and Viewer roles are checked on the server for every request."
  },
  {
    title: "Durable workflow runs",
    body: "Steps run through Inngest. A failed step stops the run and the steps after it are shown as skipped."
  },
  {
    title: "Quotas that refund",
    body: "Monthly run limits are enforced atomically. If a run cannot be queued, its reservation is given back."
  },
  {
    title: "Append-only audit log",
    body: "Every change is recorded, and the database rejects updates and deletes on the log."
  },
  {
    title: "Guarded HTTP steps",
    body: "Requests to private network addresses are blocked, so a workflow cannot be pointed at internal services."
  }
];

const NEXT = [
  "AI agent steps that call tools, with validated output",
  "Human approval gates before a workflow continues",
  "API keys for starting runs from other systems"
];

export default function Home() {
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="font-semibold tracking-tight">Sovereign</span>
        <nav aria-label="Account">
          <Link href="/sign-in" className="text-sm text-muted hover:text-ink">
            Sign in
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="py-16 sm:py-24">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Workflow automation where every tenant stays isolated.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            Define multi-step workflows, run them durably, and keep each
            organisation&rsquo;s data apart at the database layer, not just in
            application code.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-md bg-brand px-4 py-2 font-medium text-on-brand hover:opacity-90"
            >
              Open dashboard
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md border border-line px-4 py-2 font-medium hover:bg-surface"
            >
              Create account
            </Link>
          </div>
        </section>

        <section aria-labelledby="live-heading" className="pb-16">
          <h2 id="live-heading" className="text-xl font-semibold tracking-tight">
            What works today
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {LIVE.map((item) => (
              <li
                key={item.title}
                className="rounded-lg border border-line bg-surface p-5"
              >
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="next-heading" className="pb-20">
          <h2 id="next-heading" className="text-xl font-semibold tracking-tight">
            Building next
          </h2>
          <ul className="mt-4 space-y-2 text-muted">
            {NEXT.map((item) => (
              <li key={item} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-pending"
                />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-line py-6 text-sm text-muted">
        Built by Rajendra Bist &middot;{" "}
        <a
          href="https://github.com/rajendrabist07/sovereign"
          className="underline underline-offset-4 hover:text-ink"
        >
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
