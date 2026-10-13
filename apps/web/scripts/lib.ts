/** Helpers shared by the verify-*.mts scripts (no DB or app imports here). */

export function createChecker() {
  let failures = 0;
  return {
    check(label: string, ok: boolean) {
      console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
      if (!ok) failures++;
    },
    finish(): never {
      console.log(
        failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`
      );
      process.exit(failures === 0 ? 0 : 1);
    }
  };
}

/**
 * Error code of a tRPC call, or "OK". Duck-typed on purpose: an ESM script
 * and the CJS router can load two copies of @trpc/server, which breaks
 * `instanceof TRPCError`.
 */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    const e = error as { name?: string; code?: string };
    return e?.name === "TRPCError" && e.code ? e.code : "UNEXPECTED_ERROR";
  }
}

async function requireService(name: string, url: string, hint: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`${name} is not reachable at ${url}. ${hint}`);
    process.exit(2);
  }
}

/** Fail fast with a clear message if the dev stack is not running. */
export async function requireDevStack() {
  await requireService(
    "Inngest dev server",
    "http://localhost:8288",
    "Start it in a separate terminal: pnpm run dev:inngest (from the repo root)."
  );
  await requireService(
    "Next.js app",
    "http://localhost:3000/api/inngest",
    "Run pnpm dev from the repo root."
  );
}

export async function waitForTerminal<T extends { status: string }>(
  load: () => Promise<T>,
  timeoutMs = 90_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await load();
    if (run.status === "COMPLETED" || run.status === "FAILED") return run;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`run did not finish within ${timeoutMs}ms`);
}
