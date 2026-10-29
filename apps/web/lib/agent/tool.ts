import { z } from "@sovereign/shared";
import type { JsonSchemaObject, ToolSpec } from "./llm";

/** Thrown by a tool when the message is safe and useful to show the model. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

export type AgentTool = {
  spec: ToolSpec;
  invoke(rawArgs: unknown): Promise<ToolOutcome>;
};

/**
 * Builds a tool whose arguments are validated before `run` is called.
 * The schema is always strict: extra keys, such as a tenantId the model
 * invented, are rejected instead of ignored. Tenant and database access come
 * from the closure that creates the tool, never from the model.
 *
 * `parameters` is the JSON Schema the model sees. It is written by hand next
 * to the Zod shape because it is small and explicit.
 */
export function defineTool<S extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  shape: S;
  run: (input: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}): AgentTool {
  const input = z.object(definition.shape).strict();
  return {
    spec: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters
    },
    async invoke(rawArgs) {
      const parsed = input.safeParse(rawArgs);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        return { ok: false, error: `Invalid arguments: ${issues}` };
      }
      try {
        // The strict object has the same fields as the default one.
        const result = await definition.run(parsed.data as z.infer<z.ZodObject<S>>);
        return { ok: true, result };
      } catch (error) {
        // Only ToolError text reaches the model; anything else may hold secrets.
        return {
          ok: false,
          error: error instanceof ToolError ? error.message : "The tool failed."
        };
      }
    }
  };
}
