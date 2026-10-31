import { NonRetriableError } from "inngest";
import { withTenant } from "@sovereign/db";
import { getPlanLimits, stepSchema, z, type WorkflowStep } from "@sovereign/shared";
import {
  AgentError,
  DEFAULT_LIMITS,
  runAgent,
  type AgentResult,
  type AnswerFormat
} from "../lib/agent/executor";
import type { LlmClient } from "../lib/agent/llm";
import type { AgentTool } from "../lib/agent/tool";
import { httpGetTool } from "../lib/agent/tools/http-get";
import { queryRunsTool } from "../lib/agent/tools/query-runs";
import { SafeFetchError } from "../lib/net/safe-fetch";
import { addTokens, tokensUsedInMonth } from "../lib/quota/tokens";
import { recordStep } from "../lib/runs/state";

type AgentStep = Extract<WorkflowStep, { type: "AGENT" }>;
type StepOutput = Record<string, string | number | boolean | null>;

export const TOKEN_LIMIT_MESSAGE = "Monthly AI token limit reached";

async function failStep(tenantId: string, runId: string, stepIndex: number, message: string) {
  await withTenant(tenantId, (tx) =>
    recordStep(tx, runId, stepIndex, { status: "FAILED", error: message })
  );
}

function buildTools(definition: AgentStep, tenantId: string): AgentTool[] {
  const wanted = new Set(definition.tools);
  const tools: AgentTool[] = [];
  if (wanted.has("http_get")) {
    tools.push(httpGetTool({ allowedHosts: definition.allowedHosts }));
  }
  if (wanted.has("query_runs")) {
    tools.push(
      queryRunsTool({
        listRuns: (query) =>
          withTenant(tenantId, async (tx) => {
            const runs = await tx.workflowRun.findMany({
              where: query.status ? { status: query.status } : undefined,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: query.limit,
              select: {
                id: true,
                status: true,
                createdAt: true,
                workflow: { select: { name: true } }
              }
            });
            return runs.map((run) => ({
              id: run.id,
              workflow: run.workflow.name,
              status: run.status,
              createdAt: run.createdAt.toISOString()
            }));
          })
      })
    );
  }
  return tools;
}

function answerFormat(definition: AgentStep): AnswerFormat {
  const labels = definition.labels;
  if (!labels) return { format: "text" };
  return {
    format: "json",
    schema: z.object({
      label: z.enum(labels as [string, ...string[]]),
      reason: z.string().trim().min(1).max(300)
    }),
    description: `Use this shape: {"label":"<exactly one of: ${labels.join(", ")}>","reason":"<one short sentence>"}.`
  };
}

function nameOf(input: unknown, fallback: string): string {
  const parsed = stepSchema.safeParse(input);
  return parsed.success ? parsed.data.name : fallback;
}

/**
 * Runs one AGENT step: reads what the run knows so far, calls the model with
 * the step's tools, and records the result and the tokens it cost, together.
 * The model call happens outside any database transaction.
 *
 * Known limits: tokens spent by an attempt that fails with a retryable error
 * (a rate limit) are not counted, and a step that is retried after it already
 * committed is counted twice. Both err on the side of the tenant.
 */
export async function executeAgentStep(args: {
  tenantId: string;
  runId: string;
  stepIndex: number;
  definition: AgentStep;
  llm: LlmClient;
}): Promise<StepOutput> {
  const { tenantId, runId, stepIndex, definition, llm } = args;

  const prepared = await withTenant(tenantId, async (tx) => {
    await recordStep(tx, runId, stepIndex, { status: "RUNNING" });
    const run = await tx.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      select: { createdAt: true, triggerPayload: true }
    });
    const earlier = await tx.runStep.findMany({
      where: { runId, stepIndex: { lt: stepIndex }, status: "COMPLETED" },
      orderBy: { stepIndex: "asc" },
      select: { stepIndex: true, input: true, output: true }
    });
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true }
    });
    const used = await tokensUsedInMonth(tx, tenantId, run.createdAt);

    // Everything the run knows so far is outside data to the model.
    const data: Record<string, string> = {};
    if (run.triggerPayload !== null) data.trigger = JSON.stringify(run.triggerPayload);
    for (const previous of earlier) {
      const name = nameOf(previous.input, `step ${previous.stepIndex + 1}`);
      data[`step_${previous.stepIndex + 1}_${name}`] = JSON.stringify(previous.output);
    }
    return {
      createdAt: run.createdAt,
      data,
      tokensLeft: getPlanLimits(tenant.plan).tokensPerMonth - used
    };
  });

  if (prepared.tokensLeft <= 0) {
    await failStep(tenantId, runId, stepIndex, TOKEN_LIMIT_MESSAGE);
    throw new NonRetriableError(TOKEN_LIMIT_MESSAGE);
  }

  let tools: AgentTool[];
  try {
    tools = buildTools(definition, tenantId);
  } catch (error) {
    // A bad host list is a mistake in the workflow, not something to retry.
    const message = error instanceof SafeFetchError ? error.message : "The agent step is misconfigured";
    await failStep(tenantId, runId, stepIndex, message);
    throw new NonRetriableError(message, { cause: error });
  }

  const maxTotalTokens = Math.min(DEFAULT_LIMITS.maxTotalTokens, prepared.tokensLeft);

  let result: AgentResult;
  try {
    result = await runAgent({
      llm,
      task: definition.task,
      data: prepared.data,
      tools,
      answer: answerFormat(definition),
      limits: { maxTotalTokens }
    });
  } catch (error) {
    if (error instanceof AgentError) {
      await withTenant(tenantId, async (tx) => {
        await addTokens(tx, tenantId, error.tokensUsed, prepared.createdAt);
        await recordStep(tx, runId, stepIndex, { status: "FAILED", error: error.message });
      });
      throw new NonRetriableError(error.message, { cause: error });
    }
    // Anything else came from the model client: let Inngest retry it.
    throw error;
  }

  const output: StepOutput = definition.labels
    ? {
        format: "labels",
        label: (result.output as { label: string }).label,
        reason: (result.output as { reason: string }).reason,
        tokensUsed: result.tokensUsed,
        toolCalls: result.toolCalls.length
      }
    : {
        format: "text",
        text: String(result.output),
        tokensUsed: result.tokensUsed,
        toolCalls: result.toolCalls.length
      };

  await withTenant(tenantId, async (tx) => {
    await addTokens(tx, tenantId, result.tokensUsed, prepared.createdAt);
    await recordStep(tx, runId, stepIndex, { status: "COMPLETED", output });
  });
  return output;
}
