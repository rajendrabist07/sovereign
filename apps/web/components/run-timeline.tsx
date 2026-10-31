"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { stepSchema, z, type WorkflowStep } from "@sovereign/shared";
import { ListError, ListSkeleton } from "@/components/list-states";
import { RunAction } from "@/components/run-action";
import { StatusDot, type StatusDotValue } from "@/components/status-dot";
import { stepDisplayStatus } from "@/lib/step-status";
import { formatDuration, formatRelative } from "@/lib/format";
import { STEP_LABEL } from "@/lib/step-labels";
import { cn } from "@/lib/utils";
import { pollDelay, youngestActiveAge } from "@/lib/polling";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Step = RouterOutputs["run"]["get"]["steps"][number];

const NOT_FOUND_CODES = ["NOT_FOUND", "BAD_REQUEST"];

const httpOutput = z.object({
  status: z.number(),
  bodyPreview: z.string().optional(),
});
const waitOutput = z.object({ waitedSeconds: z.number() });
const approvalOutput = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().nullable()
});
const agentOutput = z.object({
  format: z.enum(["text", "labels"]),
  text: z.string().optional(),
  label: z.string().optional(),
  reason: z.string().optional(),
  tokensUsed: z.number()
});

const NODE: Record<StatusDotValue, string> = {
  PENDING: "border-line bg-paper",
  RUNNING: "border-running bg-surface motion-safe:animate-pulse",
  COMPLETED: "border-done bg-done",
  FAILED: "border-failed bg-failed",
  SKIPPED: "border-line bg-paper",
  AWAITING_APPROVAL: "border-running bg-surface motion-safe:animate-pulse",
};

function describe(definition: WorkflowStep): string {
  switch (definition.type) {
    case "HTTP_REQUEST":
      return `${definition.method} ${definition.url}`;
    case "WAIT":
      return `Pause for ${definition.seconds} s`;
    case "MANUAL_APPROVAL":
      return definition.instructions ?? "Waits for a person to approve";
    case "AGENT":
      return definition.task;
  }
}

function outcomeOf(step: Step): {
  text: string | null;
  preview: string | null;
} {
  const took =
    step.startedAt && step.finishedAt
      ? formatDuration(step.finishedAt.getTime() - step.startedAt.getTime())
      : null;

  if (step.status === "FAILED") {
    return { text: took ? `Failed after ${took}` : null, preview: null };
  }
  if (step.status !== "COMPLETED") return { text: null, preview: null };

  const http = httpOutput.safeParse(step.output);
  if (http.success) {
    return {
      text: `HTTP ${http.data.status}${took ? `, ${took}` : ""}`,
      preview: http.data.bodyPreview ?? null,
    };
  }
  const wait = waitOutput.safeParse(step.output);
  if (wait.success)
    return { text: `Waited ${wait.data.waitedSeconds} s`, preview: null };
  const agent = agentOutput.safeParse(step.output);
  if (agent.success) {
    const { format, label, reason, text, tokensUsed } = agent.data;
    return {
      text:
        format === "labels" && label
          ? `Classified as "${label}"${reason ? `: ${reason}` : ""}`
          : `${tokensUsed} tokens used`,
      preview: format === "text" ? (text ?? null) : null
    };
  }
  const approval = approvalOutput.safeParse(step.output);
  if (approval.success) {
    const label = approval.data.decision === "APPROVED" ? "Approved" : "Rejected";
    const text = approval.data.note ? `${label}: ${approval.data.note}` : label;
    return { text, preview: null };
  }
  return { text: took, preview: null };
}

function TimelineStep({
  step,
  isLast,
  runStatus,
}: {
  step: Step;
  isLast: boolean;
  runStatus: string;
}) {
  const definition = stepSchema.safeParse(step.input);
  const title = definition.success
    ? definition.data.name
    : `Step ${step.stepIndex + 1}`;
  const kind = definition.success
    ? STEP_LABEL[definition.data.type]
    : step.type;
  const detail = definition.success ? describe(definition.data) : null;
  const outcome = outcomeOf(step);
  const status = stepDisplayStatus(runStatus, step.status, step.type);

  return (
    <li className="relative pb-8 pl-9 last:pb-0">
      {!isLast && (
        <span
          aria-hidden
          className={cn(
            "absolute left-[7.5px] top-[1.375rem] -bottom-1.5 w-px",
            status === "COMPLETED" ? "bg-done" : "bg-line",
          )}
        />
      )}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1.5 size-4 rounded-full border-2",
          NODE[status],
        )}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="font-medium">
          {title} <span className="font-normal text-muted">{kind}</span>
        </p>
        <StatusDot status={status} />
      </div>
      {detail && (
        <p className="mt-0.5 break-all text-sm text-muted">{detail}</p>
      )}
      {outcome.text && (
        <p className="mt-1 text-sm tabular-nums">{outcome.text}</p>
      )}
      {step.error && (
        <p className="mt-1 border-l-2 border-failed pl-3 text-sm">
          {step.error}
        </p>
      )}
      {outcome.preview && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">
            Response preview
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-line bg-surface p-3 font-mono text-xs whitespace-pre-wrap">
            {outcome.preview}
          </pre>
        </details>
      )}
    </li>
  );
}

export function RunTimeline({ runId }: { runId: string }) {
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.run.get.queryOptions({ id: runId }),
    refetchInterval: (q) =>
      pollDelay(q.state.data ? youngestActiveAge([q.state.data]) : null),
    retry: (count, error) =>
      !NOT_FOUND_CODES.includes(error.data?.code ?? "") && count < 1,
  });

  if (query.isPending) return <ListSkeleton />;

  if (query.isError) {
    if (NOT_FOUND_CODES.includes(query.error.data?.code ?? "")) {
      return (
        <div className="space-y-2">
          <p className="font-medium">Run not found</p>
          <p className="text-muted">
            It may belong to another organization or no longer exist.
          </p>
          <Link href="/runs" className="text-sm underline underline-offset-4">
            Back to runs
          </Link>
        </div>
      );
    }
    return (
      <ListError
        title="Couldn't load this run."
        message={query.error.message}
        onRetry={() => query.refetch()}
      />
    );
  }

  const run = query.data;
  const took =
    run.startedAt && run.finishedAt
      ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
      : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/runs" className="text-sm text-muted hover:text-ink">
          Back to runs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {run.workflow.name}
          </h1>
          <RunAction
            workflowId={run.workflowId}
            archived={run.workflow.status === "ARCHIVED"}
            label="Run again"
          />
        </div>
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted"
        >
          <StatusDot status={run.status} />
          <span>Started {formatRelative(run.createdAt)}</span>
          {took && <span className="tabular-nums">Took {took}</span>}
          <span className="font-mono text-xs">{run.id}</span>
        </div>
      </header>
      <ol className="pt-2">
        {run.steps.map((step, index) => (
          <TimelineStep
            key={step.id}
            step={step}
            isLast={index === run.steps.length - 1}
            runStatus={run.status}
          />
        ))}
      </ol>
    </div>
  );
}
