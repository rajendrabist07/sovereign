import { randomUUID } from "node:crypto";
import { approvalDecidedEventSchema, approvalDecisionInputSchema } from "@sovereign/shared";
import { APPROVAL_TIMEOUT, approvalOutcome } from "../lib/runs/approval";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

const approvedRow = { decision: "APPROVED", decidedBy: "user_1", note: "looks fine" };
const approved = approvalOutcome(approvedRow, false);
check("an approved decision completes the step", approved.status === "COMPLETED");
check(
  "the output records who decided and the note",
  approved.status === "COMPLETED" &&
    approved.output.decision === "APPROVED" &&
    approved.output.decidedBy === "user_1" &&
    approved.output.note === "looks fine"
);
check(
  "an approval found after the wait timed out still completes (the wake-up event was missed)",
  approvalOutcome(approvedRow, true).status === "COMPLETED"
);

const rejected = approvalOutcome({ decision: "REJECTED", decidedBy: "user_1", note: "too risky" }, false);
check(
  "a rejection fails the step with the reason",
  rejected.status === "FAILED" && rejected.error === "Rejected: too risky"
);
const rejectedNoNote = approvalOutcome({ decision: "REJECTED", decidedBy: "user_1", note: null }, false);
check(
  "a rejection without a note fails with a plain message",
  rejectedNoNote.status === "FAILED" && rejectedNoNote.error === "Rejected"
);
const rejectedBlank = approvalOutcome({ decision: "REJECTED", decidedBy: "user_1", note: "   " }, false);
check(
  "a whitespace-only note counts as no reason",
  rejectedBlank.status === "FAILED" && rejectedBlank.error === "Rejected"
);

const undecided = { decision: null, decidedBy: null, note: null };
const expired = approvalOutcome(undecided, true);
check(
  "no decision after the timeout expires the step",
  expired.status === "FAILED" && expired.error.includes("expired")
);
const early = approvalOutcome(undecided, false);
check(
  "a wake-up with no decision fails instead of completing",
  early.status === "FAILED" && early.error.includes("before a decision")
);
check("a missing approval row fails", approvalOutcome(null, false).status === "FAILED");
check(
  "an unknown decision value fails",
  approvalOutcome({ decision: "MAYBE", decidedBy: "user_1", note: null }, false).status === "FAILED"
);
check("the approval timeout is seven days", APPROVAL_TIMEOUT === "7d");

const id = randomUUID();
const parsed = approvalDecisionInputSchema.safeParse({ approvalId: id, decision: "APPROVED", note: "  ok  " });
check("a valid decision parses and the note is trimmed", parsed.success && parsed.data.note === "ok");
check(
  "the note is optional",
  approvalDecisionInputSchema.safeParse({ approvalId: id, decision: "REJECTED" }).success
);
check(
  "an unknown decision is rejected",
  !approvalDecisionInputSchema.safeParse({ approvalId: id, decision: "MAYBE" }).success
);
check(
  "decisions are case-sensitive",
  !approvalDecisionInputSchema.safeParse({ approvalId: id, decision: "approved" }).success
);
check(
  "a non-uuid approval id is rejected",
  !approvalDecisionInputSchema.safeParse({ approvalId: "nope", decision: "APPROVED" }).success
);
check(
  "a note over 500 characters is rejected",
  !approvalDecisionInputSchema.safeParse({ approvalId: id, decision: "APPROVED", note: "x".repeat(501) }).success
);
check(
  "the event needs approval, run and tenant ids",
  approvalDecidedEventSchema.safeParse({ approvalId: id, runId: randomUUID(), tenantId: "org_1" }).success &&
    !approvalDecidedEventSchema.safeParse({ approvalId: id, runId: randomUUID() }).success
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
