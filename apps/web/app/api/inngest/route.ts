import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { runWorkflow } from "@/inngest/run-workflow";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runWorkflow]
});
