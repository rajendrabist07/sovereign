"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { StatusDot } from "@/components/status-dot";
import { formatDuration, formatRelative } from "@/lib/format";
import { useTRPC } from "@/trpc/client";

const ACTIVE = new Set(["PENDING", "RUNNING"]);

function RunsSkeleton() {
  return (
    <div className="divide-y divide-line border-y border-line" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="py-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-line motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function RecentRuns() {
  const trpc = useTRPC();
  const runs = useQuery({
    ...trpc.run.list.queryOptions({ limit: 8 }),
    // Poll only while something is in flight: every poll costs a DB transaction.
    refetchInterval: (query) =>
      query.state.data?.items.some((run) => ACTIVE.has(run.status)) ? 2000 : false
  });

  if (runs.isPending) return <RunsSkeleton />;

  if (runs.isError) {
    return (
      <div role="alert" className="space-y-3 border-y border-line py-4">
        <p>Couldn&apos;t load runs.</p>
        <p className="text-sm text-muted">{runs.error.message}</p>
        <Button variant="quiet" onClick={() => runs.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (runs.data.items.length === 0) {
    return (
      <div className="border-y border-line py-6">
        <p className="font-medium">No runs yet</p>
        <p className="text-sm text-muted">Runs appear here as soon as a workflow is started.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line border-y border-line">
      {runs.data.items.map((run) => (
        <li
          key={run.id}
          className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-x-4 py-3 sm:grid-cols-[7.5rem_1fr_8rem_5rem]"
        >
          <StatusDot status={run.status} />
          <div className="min-w-0">
            <p className="truncate font-medium">{run.workflow.name}</p>
            <p className="text-sm text-muted">
              {run._count.steps} {run._count.steps === 1 ? "step" : "steps"}
            </p>
          </div>
          <time dateTime={run.createdAt.toISOString()} className="text-sm text-muted">
            {formatRelative(run.createdAt)}
          </time>
          <span className="hidden text-right text-sm tabular-nums text-muted sm:block">
            {run.startedAt && run.finishedAt
              ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
              : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
