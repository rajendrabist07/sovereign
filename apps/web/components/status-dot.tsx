import { cn } from "@/lib/utils";

const STATUS = {
  PENDING: { label: "Queued", dot: "bg-pending" },
  RUNNING: { label: "Running", dot: "bg-running motion-safe:animate-pulse" },
  COMPLETED: { label: "Completed", dot: "bg-done" },
  FAILED: { label: "Failed", dot: "bg-failed" }
} as const;

export type RunStatusValue = keyof typeof STATUS;

// Display-only state for steps that never ran because the run failed earlier.
// Kept out of STATUS so RunStatusValue still mirrors the database enum.
const SKIPPED = { label: "Skipped", dot: "bg-line" } as const;

export type StatusDotValue = RunStatusValue | "SKIPPED";

/** Status is always dot + text label: never conveyed by color alone. */
export function StatusDot({ status }: { status: StatusDotValue }) {
  const { label, dot } = status === "SKIPPED" ? SKIPPED : STATUS[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
