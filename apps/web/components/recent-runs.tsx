"use client";

import { useQuery } from "@tanstack/react-query";
import { ListEmpty, ListError, ListSkeleton } from "@/components/list-states";
import { RunRows } from "@/components/run-rows";
import { useTRPC } from "@/trpc/client";

const ACTIVE = new Set(["PENDING", "RUNNING"]);

export function RecentRuns() {
  const trpc = useTRPC();
  const runs = useQuery({
    ...trpc.run.list.queryOptions({ limit: 8 }),
    // Poll only while something is in flight: every poll costs a DB transaction.
    refetchInterval: (query) =>
      query.state.data?.items.some((run) => ACTIVE.has(run.status)) ? 2000 : false
  });

  if (runs.isPending) return <ListSkeleton />;
  if (runs.isError) {
    return (
      <ListError
        title="Couldn't load runs."
        message={runs.error.message}
        onRetry={() => runs.refetch()}
      />
    );
  }
  if (runs.data.items.length === 0) {
    return (
      <ListEmpty
        title="No runs yet"
        hint="Runs appear here as soon as a workflow is started."
      />
    );
  }
  return <RunRows runs={runs.data.items} />;
}
