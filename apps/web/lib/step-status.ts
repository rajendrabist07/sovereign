/**
 * Display-only statuses derived from the run and step; nothing here is stored.
 *
 * - SKIPPED: a FAILED run stops at the first failing step, so a step still
 *   PENDING inside it will never run.
 * - AWAITING_APPROVAL: an approval step that is RUNNING is not working, it is
 *   waiting for a person.
 */
export function stepDisplayStatus<S extends string>(
  runStatus: string,
  stepStatus: S,
  stepType?: string
): S | "SKIPPED" | "AWAITING_APPROVAL" {
  if (runStatus === "FAILED" && stepStatus === "PENDING") return "SKIPPED";
  if (stepStatus === "RUNNING" && stepType === "MANUAL_APPROVAL") {
    return "AWAITING_APPROVAL";
  }
  return stepStatus;
}
