"use client";

import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@sovereign/shared";
import { StartRunButton } from "@/components/start-run-button";
import { useTRPC } from "@/trpc/client";

/**
 * Hides the Run button from people who cannot use it. This is a courtesy:
 * the server enforces the role on every call regardless of what the UI shows.
 */
export function RunAction({
  workflowId,
  archived = false,
  label
}: {
  workflowId: string;
  archived?: boolean;
  label?: string;
}) {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());

  if (archived) return <span className="text-sm text-muted">Archived</span>;
  if (!me.data) return <span aria-hidden className="inline-block h-9 w-14" />;
  if (!roleAtLeast(me.data.role, "MEMBER")) {
    return <span className="text-sm text-muted">View only</span>;
  }
  return <StartRunButton workflowId={workflowId} label={label} />;
}
