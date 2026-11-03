import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "@sovereign/shared";
import { getLlmClient } from "../inngest/llm";
import { runAgent } from "../lib/agent/executor";
import {
  createGroqClient,
  DEFAULT_GROQ_MODEL,
  MAX_RETRY_WAIT_MS,
  type GroqOptions
} from "../lib/agent/groq";
import { isLlmProviderError, LlmProviderError, type ChatMessage, type LlmRequest } from "../lib/agent/llm";
import { defineTool } from "../lib/agent/tool";

// Talks to a fake Groq on localhost: no network, no key, no database.

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

type Seen = {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
};
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function startStub() {
  const seen: Seen[] = [];
  let handler: Handler = (_req, res) => {
    res.statusCode = 500;
    res.end();
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seen,
    use: (next: Handler) => {
      handler = next;
    },
    reset: () => {
      seen.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const completion = (message: object, usage = { prompt_tokens: 80, completion_tokens: 20 }) => ({
  choices: [{ message }],
  usage
});

async function failure(promise: Promise<unknown>): Promise<LlmProviderError | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return isLlmProviderError(error) ? error : null;
  }
}

const KEY = "gsk_test_SECRET_KEY_123";
const SPEC = {
  name: "lookup",
  description: "Look rows up",
  parameters: {
    type: "object" as const,
    properties: { limit: { type: "integer" } },
    required: ["limit"],
    additionalProperties: false as const
  }
};
const messages: ChatMessage[] = [
  { role: "system", content: "SYS" },
  { role: "user", content: "USER" },
  { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "lookup", arguments: '{"limit":2}' }] },
  { role: "tool", toolCallId: "call_1", content: "TOOLRESULT" }
];
const request: LlmRequest = { messages, tools: [SPEC] };

const stub = await startStub();
const client = (extra: Partial<GroqOptions> = {}) =>
  createGroqClient({ apiKey: KEY, baseUrl: stub.baseUrl, ...extra });
const lastBody = () => JSON.parse(stub.seen.at(-1)?.body ?? "{}");

const savedKey = process.env.GROQ_API_KEY;
try {
  // What is sent
  stub.use((_req, res) => reply(res, 200, completion({ content: "Hello" })));
  await client().complete(request);
  const sent = stub.seen[0];
  const body = lastBody();
  check("it POSTs to /chat/completions", sent?.method === "POST" && sent.url === "/chat/completions");
  check("it authenticates with the key as a bearer token", sent?.headers.authorization === `Bearer ${KEY}`);
  check(
    "it asks for the default model at a low temperature with a bounded answer",
    body.model === DEFAULT_GROQ_MODEL && body.temperature === 0.2 && body.max_tokens === 1024
  );
  check(
    "an assistant turn keeps its tool calls in the OpenAI shape",
    JSON.stringify(body.messages[2]) ===
      JSON.stringify({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"limit":2}' } }]
      })
  );
  check(
    "a tool result is sent with the id of the call it answers",
    JSON.stringify(body.messages[3]) ===
      JSON.stringify({ role: "tool", tool_call_id: "call_1", content: "TOOLRESULT" })
  );
  check(
    "system and user messages pass through",
    body.messages[0].role === "system" && body.messages[0].content === "SYS" && body.messages[1].content === "USER"
  );
  check(
    "tools are sent as functions with automatic tool choice",
    JSON.stringify(body.tools) ===
      JSON.stringify([
        {
          type: "function",
          function: { name: SPEC.name, description: SPEC.description, parameters: SPEC.parameters }
        }
      ]) && body.tool_choice === "auto"
  );

  stub.reset();
  await client({ model: "other-model", maxOutputTokens: 256 }).complete(request);
  check(
    "a custom model and output cap are used",
    lastBody().model === "other-model" && lastBody().max_tokens === 256
  );
  stub.reset();
  await client().complete({ messages: messages.slice(0, 2), tools: [] });
  check(
    "without tools the request has neither tools nor tool_choice",
    !("tools" in lastBody()) && !("tool_choice" in lastBody())
  );

  // What comes back
  stub.use((_req, res) =>
    reply(res, 200, completion({ content: "Hi there" }, { prompt_tokens: 120, completion_tokens: 30 }))
  );
  const plain = await client().complete(request);
  check(
    "a text answer and its token usage are returned",
    plain.content === "Hi there" &&
      plain.toolCalls.length === 0 &&
      plain.usage.promptTokens === 120 &&
      plain.usage.completionTokens === 30
  );
  stub.use((_req, res) =>
    reply(
      res,
      200,
      completion({
        content: null,
        tool_calls: [{ id: "call_9", type: "function", function: { name: "lookup", arguments: '{"limit":3}' } }]
      })
    )
  );
  const withCall = await client().complete(request);
  check(
    "a tool call is returned with its id, name and raw argument text",
    withCall.content === null &&
      withCall.toolCalls.length === 1 &&
      withCall.toolCalls[0]?.id === "call_9" &&
      withCall.toolCalls[0].name === "lookup" &&
      withCall.toolCalls[0].arguments === '{"limit":3}'
  );
  stub.use((_req, res) => reply(res, 200, completion({})));
  check("a message with no content is returned as null", (await client().complete(request)).content === null);

  // Rate limits
  stub.use((_req, res) => reply(res, 429, { error: { message: "slow down" } }, { "retry-after": "7" }));
  const waited = await failure(client().complete(request));
  check(
    "a rate limit with retry-after is retryable after exactly that wait",
    waited?.retryable === true && waited.retryAfterMs === 7000
  );
  stub.use((_req, res) => reply(res, 429, {}, { "retry-after": "0.5" }));
  check("a fractional retry-after is understood", (await failure(client().complete(request)))?.retryAfterMs === 500);
  stub.use((_req, res) => reply(res, 429, {}));
  const noHeader = await failure(client().complete(request));
  check(
    "a rate limit without retry-after waits a default 10 seconds",
    noHeader?.retryable === true && noHeader.retryAfterMs === 10_000
  );
  stub.use((_req, res) => reply(res, 429, {}, { "retry-after": "soon" }));
  check(
    "an unreadable retry-after falls back to the default",
    (await failure(client().complete(request)))?.retryAfterMs === 10_000
  );
  stub.use((_req, res) => reply(res, 429, {}, { "retry-after": String(MAX_RETRY_WAIT_MS / 1000 + 1) }));
  const daily = await failure(client().complete(request));
  check("a wait longer than two minutes is not worth holding a run for: permanent", daily?.retryable === false);

  // Other failures
  for (const status of [500, 502, 503]) {
    stub.use((_req, res) => reply(res, status, { error: { message: "SECRET-BODY-TEXT" } }));
    const error = await failure(client().complete(request));
    check(
      `a ${status} is retryable and says nothing about the response`,
      error?.retryable === true && error.retryAfterMs === null && !error.message.includes("SECRET-BODY-TEXT")
    );
  }
  stub.use((_req, res) => reply(res, 401, { error: { message: `Invalid API key ${KEY}` } }));
  const rejected = await failure(client().complete(request));
  check(
    "a rejected API key is a permanent error with a safe message",
    rejected?.retryable === false &&
      rejected.message === "The AI provider rejected the API key" &&
      !rejected.message.includes(KEY)
  );
  stub.use((_req, res) => reply(res, 403, {}));
  check("a 403 is treated like a rejected key", (await failure(client().complete(request)))?.retryable === false);
  stub.use((_req, res) => reply(res, 404, { error: { message: "model gone" } }));
  const missing = await failure(client().complete(request));
  check(
    "a missing model is permanent and named as such",
    missing?.retryable === false && missing.message === "The AI model was not found"
  );
  stub.use((_req, res) => reply(res, 400, { error: { message: "bad request SECRET-BODY-TEXT" } }));
  const bad = await failure(client().complete(request));
  check(
    "a rejected request is permanent and does not repeat the provider's words",
    bad?.retryable === false && !bad.message.includes("SECRET-BODY-TEXT")
  );

  // Answers that cannot be used
  stub.use((_req, res) => reply(res, 200, "this is not json"));
  check("an answer that is not JSON is retryable", (await failure(client().complete(request)))?.retryable === true);
  stub.use((_req, res) => reply(res, 200, { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  check("an answer with no choices is retryable", (await failure(client().complete(request)))?.retryable === true);
  stub.use((_req, res) => reply(res, 200, { choices: [{ message: { content: "hi" } }] }));
  check(
    "an answer with no token usage is refused, because it could not be accounted for",
    (await failure(client().complete(request)))?.retryable === true
  );
  stub.use((_req, res) => reply(res, 200, "x".repeat(1_200_000)));
  const huge = await failure(client().complete(request));
  check(
    "an answer over 1 MB is refused as too large",
    huge?.retryable === false && huge.message === "The AI provider's answer was too large"
  );

  // Network trouble
  stub.use(() => {
    // never answers
  });
  const slow = await failure(client({ timeoutMs: 150 }).complete(request));
  check(
    "no answer within the timeout is retryable and says so",
    slow?.retryable === true && slow.message === "The AI provider did not answer in time"
  );
  const down = await failure(createGroqClient({ apiKey: KEY, baseUrl: "http://127.0.0.1:1" }).complete(request));
  check(
    "a host that refuses the connection is retryable and does not leak the key",
    down?.retryable === true && down.message === "The AI provider could not be reached" && !down.message.includes(KEY)
  );
  stub.reset();
  stub.use((req, res) => {
    if (req.url === "/chat/completions") {
      res.writeHead(302, { location: "/other" });
      res.end();
    } else {
      reply(res, 200, completion({ content: "followed" }));
    }
  });
  const redirected = await failure(client().complete(request));
  check(
    "a redirect is never followed",
    redirected !== null && stub.seen.length === 1 && stub.seen[0]?.url === "/chat/completions"
  );

  // The error type and the factory
  check(
    "an LlmProviderError is recognised, an ordinary error and a look-alike are not",
    isLlmProviderError(new LlmProviderError("x", { retryable: true })) &&
      !isLlmProviderError(new Error("x")) &&
      !isLlmProviderError({ name: "LlmProviderError" })
  );
  let blank = false;
  try {
    createGroqClient({ apiKey: "   " });
  } catch {
    blank = true;
  }
  check("a client cannot be created without a key", blank);

  delete process.env.GROQ_API_KEY;
  let thrown: unknown;
  try {
    getLlmClient();
  } catch (error) {
    thrown = error;
  }
  check(
    "without GROQ_API_KEY the model is reported as not configured",
    (thrown as { name?: string } | undefined)?.name === "NonRetriableError" &&
      (thrown as Error).message === "No language model is configured yet"
  );
  process.env.GROQ_API_KEY = "   ";
  thrown = undefined;
  try {
    getLlmClient();
  } catch (error) {
    thrown = error;
  }
  check("a blank key counts as missing", thrown !== undefined);
  process.env.GROQ_API_KEY = KEY;
  check("with a key set, a client is returned", typeof getLlmClient().complete === "function");

  // Through the agent loop, over real HTTP
  stub.reset();
  const lookup = defineTool({
    name: "lookup",
    description: "Look rows up",
    parameters: SPEC.parameters,
    shape: { limit: z.number().int().min(1).max(10) },
    run: async ({ limit }) => ({ rows: limit })
  });
  let turn = 0;
  stub.use((_req, res) => {
    turn++;
    if (turn === 1) {
      reply(
        res,
        200,
        completion(
          { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: '{"limit":2}' } }] },
          { prompt_tokens: 100, completion_tokens: 20 }
        )
      );
    } else {
      reply(res, 200, completion({ content: "Found 2 rows" }, { prompt_tokens: 150, completion_tokens: 30 }));
    }
  });
  const result = await runAgent({ llm: client(), task: "Find rows", tools: [lookup] });
  check(
    "an agent that uses a tool finishes over the wire with the right answer and token total",
    result.output === "Found 2 rows" && result.tokensUsed === 300 && result.iterations === 2 && stub.seen.length === 2
  );
  const second = JSON.parse(stub.seen[1]?.body ?? "{}");
  const roles = (second.messages as Array<{ role: string }>).map((m) => m.role);
  check(
    "the second request carries the assistant's tool call and the tool's answer",
    roles.join(",") === "system,user,assistant,tool" &&
      second.messages[2].tool_calls[0].id === "c1" &&
      second.messages[3].tool_call_id === "c1"
  );
  check(
    "the key is only ever sent as the authorization header, never in a body",
    stub.seen.every((s) => !s.body.includes(KEY))
  );
} finally {
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
  await stub.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
