const ACTIVE = new Set(["PENDING", "RUNNING"]);

/** Age in ms of the newest run that is still in flight, or null if none is. */
export function youngestActiveAge(
  runs: ReadonlyArray<{ status: string; createdAt: Date }>,
  now: number = Date.now()
): number | null {
  let youngest: number | null = null;
  for (const run of runs) {
    if (!ACTIVE.has(run.status)) continue;
    const age = now - run.createdAt.getTime();
    if (youngest === null || age < youngest) youngest = age;
  }
  return youngest;
}

/**
 * Poll fast while a run is young (it changes often), slower as it ages
 * (a run waiting for days must not hold a request open every 1.5 s), and
 * not at all when nothing is in flight. Keyed to the run's age, not to
 * how long the tab has been open.
 */
export function pollDelay(youngestActiveAgeMs: number | null): number | false {
  if (youngestActiveAgeMs === null) return false;
  if (youngestActiveAgeMs < 30_000) return 1500;
  if (youngestActiveAgeMs < 120_000) return 3000;
  if (youngestActiveAgeMs < 600_000) return 5000;
  return 10_000;
}
