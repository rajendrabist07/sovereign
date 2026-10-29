import { cn } from "@/lib/utils";

const STATUS = {
  PENDING: { label: "Queued", dot: "bg-pending" },
  RUNNING: { label: "Running", dot: "bg-running motion-safe:animate-pulse" },
  COMPLETED: { label: "Completed", dot: "bg-done" },
  FAILED: { label: "Failed", dot: "bg-failed" }
} as const;

export type RunStatusValue = keyof typeof STATUS;

// Display-only states derived in stepDisplayStatus. Kept out of STATUS so
// RunStatusValue still mirrors the database enum.
const DISPLAY_ONLY = {
  SKIPPED: { label: "Skipped", dot: "bg-line" },
  AWAITING_APPROVAL: {
    label: "Waiting for approval",
    dot: "bg-running motion-safe:animate-pulse"
  }
} as const;

export type StatusDotValue = RunStatusValue | keyof typeof DISPLAY_ONLY;

function lookup(status: StatusDotValue) {
  return status === "SKIPPED" || status === "AWAITING_APPROVAL"
    ? DISPLAY_ONLY[status]
    : STATUS[status];
}

/** Status is always dot + text label: never conveyed by color alone. */
export function StatusDot({ status }: { status: StatusDotValue }) {
  const { label, dot } = lookup(status);
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
