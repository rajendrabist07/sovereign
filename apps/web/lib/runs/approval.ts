import type { ApprovalDecision } from "@sovereign/shared";

/** How long a run waits for a human before the approval step fails. */
export const APPROVAL_TIMEOUT = "7d";

export type ApprovalRow = {
  decision: string | null;
  decidedBy: string | null;
  note: string | null;
};

export type ApprovalOutcome =
  | {
      status: "COMPLETED";
      output: { decision: ApprovalDecision; decidedBy: string; note: string | null };
    }
  | { status: "FAILED"; error: string };

/**
 * Turns the approvals row into what the step records. The row, not the
 * wake-up event, is the source of truth: a decision made just before the run
 * started waiting is not delivered as an event, so after the wait (event or
 * timeout) the runner reads the row and passes it here.
 */
export function approvalOutcome(row: ApprovalRow | null, timedOut: boolean): ApprovalOutcome {
  if (!row) return { status: "FAILED", error: "Approval request not found" };

  if (row.decision === "APPROVED") {
    return {
      status: "COMPLETED",
      output: { decision: "APPROVED", decidedBy: row.decidedBy ?? "unknown", note: row.note }
    };
  }
  if (row.decision === "REJECTED") {
    const reason = row.note?.trim();
    return { status: "FAILED", error: reason ? `Rejected: ${reason}` : "Rejected" };
  }
  if (row.decision === null) {
    return {
      status: "FAILED",
      error: timedOut
        ? "Approval expired after 7 days without a decision"
        : "Woken up before a decision was recorded"
    };
  }
  return { status: "FAILED", error: "Unknown approval decision" };
}
