import type { AgentToolName, WorkflowStep } from "@sovereign/shared";

export const STEP_LABEL: Record<WorkflowStep["type"], string> = {
  HTTP_REQUEST: "HTTP request",
  WAIT: "Wait",
  MANUAL_APPROVAL: "Approval",
  AGENT: "AI agent"
};

/** Typed against the tool list: adding a tool to the schema fails the build until it is described here. */
export const AGENT_TOOL_LABEL: Record<AgentToolName, { label: string; description: string }> = {
  http_get: {
    label: "Fetch web pages",
    description: "Reads pages on the hosts you list below. Read-only."
  },
  query_runs: {
    label: "Look at recent runs",
    description: "Reads this organisation's recent runs. Read-only."
  }
};
