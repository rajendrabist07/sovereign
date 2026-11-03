"use client";

import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@sovereign/shared";
import { ListEmpty, ListError, ListSkeleton } from "@/components/list-states";
import { WorkflowForm } from "@/components/workflow-form";
import { workflowToDraft } from "@/lib/workflow-draft";
import { useTRPC } from "@/trpc/client";

const NOT_FOUND_CODES = ["NOT_FOUND", "BAD_REQUEST"];

/** Decides what to show for /workflows/new and /workflows/[id]/edit. */
export function WorkflowEditor({ workflowId }: { workflowId?: string }) {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  const workflow = useQuery({
    ...trpc.workflow.get.queryOptions({ id: workflowId ?? "" }),
    enabled: Boolean(workflowId),
    retry: (count, error) =>
      !NOT_FOUND_CODES.includes(error.data?.code ?? "") && count < 1
  });

  if (me.isPending) return <ListSkeleton />;
  if (me.isError) {
    return (
      <ListError
        title="Couldn't check your permissions."
        message={me.error.message}
        onRetry={() => me.refetch()}
      />
    );
  }
  // The server enforces this too; this only avoids showing a form that cannot be saved.
  if (!roleAtLeast(me.data.role, "ADMIN")) {
    return (
      <ListEmpty
        title="Admins only"
        hint="Ask an admin of this organization to create or change workflows."
      />
    );
  }

  if (!workflowId) return <WorkflowForm />;

  if (workflow.isPending) return <ListSkeleton />;
  if (workflow.isError) {
    if (NOT_FOUND_CODES.includes(workflow.error.data?.code ?? "")) {
      return (
        <ListEmpty
          title="Workflow not found"
          hint="It may belong to another organization or no longer exist."
        />
      );
    }
    return (
      <ListError
        title="Couldn't load this workflow."
        message={workflow.error.message}
        onRetry={() => workflow.refetch()}
      />
    );
  }

  const initial = workflowToDraft(workflow.data, () => crypto.randomUUID());
  if (!initial) {
    return (
      <ListEmpty
        title="This workflow can't be edited here yet"
        hint="Its saved definition is not valid, so it cannot be shown in the editor."
      />
    );
  }
  return <WorkflowForm key={workflowId} workflowId={workflowId} initial={initial} />;
}
