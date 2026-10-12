import type { TenantTx } from "@sovereign/db";
import { deriveRunStatus } from "@sovereign/shared";

/**
 * The ONLY place that writes workflow_runs.status. The status is derived
 * from the run's steps (run_steps is the source of truth).
 */
export async function syncRunStatus(tx: TenantTx, runId: string) {
  const steps = await tx.runStep.findMany({
    where: { runId },
    select: { status: true }
  });
  const run = await tx.workflowRun.findUniqueOrThrow({
    where: { id: runId },
    select: { startedAt: true, finishedAt: true }
  });

  const status = deriveRunStatus(steps.map((s) => s.status));
  const now = new Date();
  const finished = status === "COMPLETED" || status === "FAILED";

  await tx.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      startedAt: run.startedAt ?? (status === "PENDING" ? null : now),
      finishedAt: finished ? (run.finishedAt ?? now) : null
    }
  });
}

type StepPatch =
  | { status: "RUNNING" }
  | { status: "COMPLETED"; output: Record<string, string | number | boolean | null> }
  | { status: "FAILED"; error: string };

/** Records one step's state, then re-derives the run's status. */
export async function recordStep(
  tx: TenantTx,
  runId: string,
  stepIndex: number,
  patch: StepPatch
) {
  const now = new Date();
  await tx.runStep.updateMany({
    where: { runId, stepIndex },
    data:
      patch.status === "RUNNING"
        ? { status: "RUNNING", startedAt: now }
        : patch.status === "COMPLETED"
          ? { status: "COMPLETED", output: patch.output, error: null, finishedAt: now }
          : { status: "FAILED", error: patch.error, finishedAt: now }
  });
  await syncRunStatus(tx, runId);
}
