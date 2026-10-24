/**
 * A FAILED run is terminal and stops at the first failing step, so a step
 * still PENDING inside it will never run. Show it as SKIPPED instead of
 * "Queued". Display-only: nothing in the database changes.
 */
export function stepDisplayStatus<S extends string>(
  runStatus: string,
  stepStatus: S
): S | "SKIPPED" {
  return runStatus === "FAILED" && stepStatus === "PENDING" ? "SKIPPED" : stepStatus;
}
