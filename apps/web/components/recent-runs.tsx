"use client";

import { useQuery } from "@tanstack/react-query";
import { ListEmpty, ListError, ListSkeleton } from "@/components/list-states";
import { RunRows } from "@/components/run-rows";
import { pollDelay, youngestActiveAge } from "@/lib/polling";
import { useTRPC } from "@/trpc/client";

export function RecentRuns() {
  const trpc = useTRPC();
  const runs = useQuery({
    ...trpc.run.list.queryOptions({ limit: 8 }),
    // Poll only while something is in flight: every poll costs a DB transaction.
    refetchInterval: (query) =>
      pollDelay(query.state.data ? youngestActiveAge(query.state.data.items) : null)
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
