import Link from "next/link";
import { StatusDot } from "@/components/status-dot";
import { formatDuration, formatRelative } from "@/lib/format";
import type { RouterOutputs } from "@/trpc/types";

export type RunListItem = RouterOutputs["run"]["list"]["items"][number];

export function RunRows({ runs }: { runs: RunListItem[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {runs.map((run) => (
        <li key={run.id}>
          <Link
            href={`/runs/${run.id}`}
            className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-x-4 py-3 hover:bg-surface sm:grid-cols-[7.5rem_1fr_8rem_5rem]"
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
          </Link>
        </li>
      ))}
    </ul>
  );
}
