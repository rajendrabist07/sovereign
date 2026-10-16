"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

export function QuotaMeter() {
  const trpc = useTRPC();
  const quota = useQuery(trpc.quota.current.queryOptions());

  if (quota.isPending) {
    return <div className="h-14 animate-pulse rounded-md bg-line motion-reduce:animate-none" />;
  }
  if (quota.isError) {
    return <p className="text-sm text-muted">Usage is unavailable right now.</p>;
  }

  const { used, limit, resetAt } = quota.data;
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const nearLimit = percent >= 90;
  const resets = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(resetAt);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-baseline justify-between">
        <span>Runs this month</span>
        <span className="tabular-nums">
          {used} / {limit}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Runs used this month"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div
          className={cn("h-full rounded-full", nearLimit ? "bg-failed" : "bg-brand")}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-muted">
        {nearLimit ? "Almost at your limit. " : ""}Resets {resets}
      </p>
    </div>
  );
}
