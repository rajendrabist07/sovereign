"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { roleAtLeast, workflowDefinitionSchema } from "@sovereign/shared";
import { ListEmpty, ListError, ListSkeleton } from "@/components/list-states";
import { RunAction } from "@/components/run-action";
import { formatRelative } from "@/lib/format";
import { STEP_LABEL } from "@/lib/step-labels";
import { useTRPC } from "@/trpc/client";

const MAX_LABELS = 4;

function summarize(definition: unknown): string {
  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) return "This definition needs attention";
  const { steps } = parsed.data;
  const labels = steps.slice(0, MAX_LABELS).map((step) => STEP_LABEL[step.type]);
  const more = steps.length > MAX_LABELS ? `, and ${steps.length - MAX_LABELS} more` : "";
  return `${steps.length} ${steps.length === 1 ? "step" : "steps"}: ${labels.join(", then ")}${more}`;
}

export function WorkflowList() {
  const trpc = useTRPC();
  const workflows = useQuery(trpc.workflow.list.queryOptions());
  const me = useQuery(trpc.me.queryOptions());
  const canEdit = me.data ? roleAtLeast(me.data.role, "ADMIN") : false;

  if (workflows.isPending) return <ListSkeleton />;
  if (workflows.isError) {
    return (
      <ListError
        title="Couldn't load workflows."
        message={workflows.error.message}
        onRetry={() => workflows.refetch()}
      />
    );
  }
  if (workflows.data.length === 0) {
    return (
      <ListEmpty
        title="No workflows yet"
        hint={canEdit ? "Create your first workflow to start running automations." : "Workflows your admins create show up here."}
      />
    );
  }

  return (
    <ul className="divide-y divide-line border-y border-line">
      {workflows.data.map((workflow) => (
        <li key={workflow.id} className="flex items-center gap-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{workflow.name}</p>
            <p className="truncate text-sm text-muted">{summarize(workflow.definition)}</p>
          </div>
          <time
            dateTime={workflow.createdAt.toISOString()}
            className="hidden text-sm text-muted sm:block"
          >
            {formatRelative(workflow.createdAt)}
          </time>
          {canEdit && (
            <Link
              href={`/workflows/${workflow.id}/edit`}
              aria-label={`Edit ${workflow.name}`}
              className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Edit
            </Link>
          )}
          <RunAction
            workflowId={workflow.id}
            archived={workflow.status === "ARCHIVED"}
          />
        </li>
      ))}
    </ul>
  );
}
