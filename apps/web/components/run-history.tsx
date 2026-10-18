"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { ListEmpty, ListError, ListSkeleton } from "@/components/list-states";
import { RunRows } from "@/components/run-rows";
import { useTRPC } from "@/trpc/client";

const ACTIVE = new Set(["PENDING", "RUNNING"]);
const PAGE_SIZE = 10;

export function RunHistory() {
  const trpc = useTRPC();
  const runs = useInfiniteQuery({
    ...trpc.run.list.infiniteQueryOptions(
      { limit: PAGE_SIZE },
      { getNextPageParam: (lastPage) => lastPage.nextCursor }
    ),
    // Polling refetches every loaded page, so keep it to "something is in flight".
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some((run) => ACTIVE.has(run.status))
      )
        ? 2000
        : false
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

  const items = runs.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return (
      <ListEmpty
        title="No runs yet"
        hint="Start a workflow and its run shows up here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <RunRows runs={items} />
      {runs.hasNextPage && (
        <Button
          variant="quiet"
          onClick={() => runs.fetchNextPage()}
          disabled={runs.isFetchingNextPage}
        >
          {runs.isFetchingNextPage ? "Loading" : "Load more"}
        </Button>
      )}
    </div>
  );
}
