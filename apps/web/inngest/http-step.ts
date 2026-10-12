import { NonRetriableError } from "inngest";
import { withTenant } from "@sovereign/db";
import type { WorkflowStep } from "@sovereign/shared";
import { recordStep } from "../lib/runs/state";

type HttpStep = Extract<WorkflowStep, { type: "HTTP_REQUEST" }>;

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 4096;

/**
 * First-line SSRF guard: https only, and no localhost / private-range
 * literals. It does NOT resolve DNS, so a public name pointing at a
 * private IP still passes; the full defence (resolve + pin the IP +
 * per-tenant allowlist) arrives with the Phase 2 call_webhook tool.
 */
export function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new NonRetriableError("Only https:// URLs are allowed");
  }
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]" ||
    /^\[(fc|fd|fe80)/.test(host);
  if (isPrivate) {
    throw new NonRetriableError("Private or local addresses are not allowed");
  }
  return url;
}

// Read at most maxBytes so a huge response can't exhaust memory or DB row size.
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, maxBytes);
}

export async function executeHttpStep(args: {
  tenantId: string;
  runId: string;
  stepIndex: number;
  definition: HttpStep;
}) {
  const { tenantId, runId, stepIndex, definition } = args;

  // Short transaction; the network call below happens OUTSIDE any transaction.
  await withTenant(tenantId, (tx) =>
    recordStep(tx, runId, stepIndex, { status: "RUNNING" })
  );

  const url = assertSafeUrl(definition.url);
  const hasBody = ["POST", "PUT", "PATCH"].includes(definition.method);

  const response = await fetch(url, {
    method: definition.method,
    headers: {
      "User-Agent": "Sovereign-Workflow/1.0",
      // Same key on every retry, so the receiver can dedupe a repeated request.
      "Idempotency-Key": `${runId}:${stepIndex}`,
      ...(hasBody && definition.body ? { "Content-Type": "application/json" } : {})
    },
    body: hasBody ? definition.body : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const bodyPreview = await readCapped(response, MAX_BODY_BYTES);

  if (response.status === 429 || response.status >= 500) {
    throw new Error(`HTTP ${response.status} (will retry)`);
  }
  if (!response.ok) {
    throw new NonRetriableError(`HTTP ${response.status}`);
  }

  const output = { status: response.status, bodyPreview };
  await withTenant(tenantId, (tx) =>
    recordStep(tx, runId, stepIndex, { status: "COMPLETED", output })
  );
  return output;
}
