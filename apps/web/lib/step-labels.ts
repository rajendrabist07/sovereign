import type { WorkflowStep } from "@sovereign/shared";

export const STEP_LABEL: Record<WorkflowStep["type"], string> = {
  HTTP_REQUEST: "HTTP request",
  WAIT: "Wait",
  MANUAL_APPROVAL: "Approval",
  AGENT: "AI agent"
};
